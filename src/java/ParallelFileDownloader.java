import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/**
 * A standalone Java class for downloading large files with parallel segments using HTTP Range requests.
 * Supports resumable downloads and automatic segment merging.
 */
public class ParallelFileDownloader {
    
    private final ExecutorService executorService;
    private final int connectTimeoutMs;
    private final int readTimeoutMs;
    private final long segmentSize;
    private final int maxRetries;
    
    public ParallelFileDownloader(ExecutorService executorService, int connectTimeoutMs, int readTimeoutMs) {
        this(executorService, connectTimeoutMs, readTimeoutMs, 1024 * 1024, 3); // Default 1MB segments, 3 retries
    }
    
    public ParallelFileDownloader(ExecutorService executorService, int connectTimeoutMs, int readTimeoutMs, 
                                 long segmentSize, int maxRetries) {
        this.executorService = executorService;
        this.connectTimeoutMs = connectTimeoutMs;
        this.readTimeoutMs = readTimeoutMs;
        this.segmentSize = segmentSize;
        this.maxRetries = maxRetries;
    }
    
    /**
     * Downloads a file from the given URL to the specified destination path using parallel segments.
     * 
     * @param sourceURL The URL to download from
     * @param destinationPath The local file path where the file should be saved
     * @return true if download was successful, false otherwise
     * @throws Exception if download fails
     */
    public boolean downloadFile(String sourceURL, Path destinationPath) throws Exception {
        // Get file size and check if server supports range requests
        long fileSize = getFileSize(sourceURL);
        if (fileSize <= 0) {
            throw new IllegalArgumentException("Unable to determine file size or file is empty");
        }
        
        // Check if server supports range requests
        if (!supportsRangeRequests(sourceURL)) {
            // Fall back to single-threaded download
            return downloadSingleThreaded(sourceURL, destinationPath);
        }
        
        // Calculate number of segments
        int numSegments = (int) Math.ceil((double) fileSize / segmentSize);
        System.out.println("Downloading " + fileSize + " bytes in " + numSegments + " segments of ~" + segmentSize + " bytes each");
        
        // Create temporary directory for segments
        Path tempDir = Files.createTempDirectory("download_segments_");
        List<Path> segmentFiles = new ArrayList<>();
        List<Future<Boolean>> downloadTasks = new ArrayList<>();
        
        try {
            // Submit download tasks for each segment
            for (int i = 0; i < numSegments; i++) {
                long startByte = i * segmentSize;
                long endByte = Math.min(startByte + segmentSize - 1, fileSize - 1);
                Path segmentFile = tempDir.resolve("segment_" + i + ".tmp");
                segmentFiles.add(segmentFile);
                
                SegmentDownloader segmentDownloader = new SegmentDownloader(
                    sourceURL, segmentFile, startByte, endByte, i
                );
                
                downloadTasks.add(executorService.submit(segmentDownloader));
            }
            
            // Wait for all downloads to complete
            boolean allSuccess = true;
            for (int i = 0; i < downloadTasks.size(); i++) {
                try {
                    boolean success = downloadTasks.get(i).get();
                    if (!success) {
                        System.err.println("Segment " + i + " download failed");
                        allSuccess = false;
                    }
                } catch (Exception e) {
                    System.err.println("Segment " + i + " download exception: " + e.getMessage());
                    allSuccess = false;
                }
            }
            
            if (!allSuccess) {
                throw new RuntimeException("One or more segments failed to download");
            }
            
            // Merge all segments into final file
            mergeSegments(segmentFiles, destinationPath);
            System.out.println("Download completed successfully: " + destinationPath);
            return true;
            
        } finally {
            // Clean up temporary files
            cleanupTempFiles(segmentFiles, tempDir);
        }
    }
    
    /**
     * Gets the file size using a HEAD request.
     */
    private long getFileSize(String sourceURL) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(sourceURL).openConnection();
        connection.setRequestMethod("HEAD");
        connection.setConnectTimeout(connectTimeoutMs);
        connection.setReadTimeout(readTimeoutMs);
        
        try {
            int responseCode = connection.getResponseCode();
            if (responseCode == HttpURLConnection.HTTP_OK) {
                String contentLength = connection.getHeaderField("Content-Length");
                if (contentLength != null) {
                    return Long.parseLong(contentLength);
                }
            }
        } finally {
            connection.disconnect();
        }
        
        return -1;
    }
    
    /**
     * Checks if the server supports HTTP Range requests.
     */
    private boolean supportsRangeRequests(String sourceURL) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(sourceURL).openConnection();
        connection.setRequestMethod("HEAD");
        connection.setConnectTimeout(connectTimeoutMs);
        connection.setReadTimeout(readTimeoutMs);
        
        try {
            int responseCode = connection.getResponseCode();
            if (responseCode == HttpURLConnection.HTTP_OK) {
                String acceptRanges = connection.getHeaderField("Accept-Ranges");
                return "bytes".equalsIgnoreCase(acceptRanges);
            }
        } finally {
            connection.disconnect();
        }
        
        return false;
    }
    
    /**
     * Downloads the file using a single thread (fallback method).
     */
    private boolean downloadSingleThreaded(String sourceURL, Path destinationPath) throws IOException {
        System.out.println("Server doesn't support range requests, falling back to single-threaded download");
        
        URLConnection sourceUrl = new URL(sourceURL).openConnection();
        sourceUrl.setConnectTimeout(connectTimeoutMs);
        sourceUrl.setReadTimeout(readTimeoutMs);
        
        try (InputStream inputStream = sourceUrl.getInputStream();
             OutputStream outputStream = Files.newOutputStream(destinationPath)) {
            
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
            }
        }
        
        return true;
    }
    
    /**
     * Merges all segment files into the final destination file.
     */
    private void mergeSegments(List<Path> segmentFiles, Path destinationPath) throws IOException {
        try (OutputStream outputStream = Files.newOutputStream(destinationPath)) {
            for (Path segmentFile : segmentFiles) {
                if (Files.exists(segmentFile)) {
                    Files.copy(segmentFile, outputStream);
                }
            }
        }
    }
    
    /**
     * Cleans up temporary segment files and directory.
     */
    private void cleanupTempFiles(List<Path> segmentFiles, Path tempDir) {
        for (Path segmentFile : segmentFiles) {
            try {
                Files.deleteIfExists(segmentFile);
            } catch (IOException e) {
                System.err.println("Failed to delete temp file: " + segmentFile + " - " + e.getMessage());
            }
        }
        
        try {
            Files.deleteIfExists(tempDir);
        } catch (IOException e) {
            System.err.println("Failed to delete temp directory: " + tempDir + " - " + e.getMessage());
        }
    }
    
    /**
     * Inner class that handles downloading a single segment using Range requests.
     */
    private class SegmentDownloader implements Callable<Boolean> {
        private final String sourceURL;
        private final Path segmentFile;
        private final long startByte;
        private final long endByte;
        private final int segmentIndex;
        
        public SegmentDownloader(String sourceURL, Path segmentFile, long startByte, long endByte, int segmentIndex) {
            this.sourceURL = sourceURL;
            this.segmentFile = segmentFile;
            this.startByte = startByte;
            this.endByte = endByte;
            this.segmentIndex = segmentIndex;
        }
        
        @Override
        public Boolean call() throws Exception {
            int attempts = 0;
            Exception lastException = null;
            
            while (attempts < maxRetries) {
                try {
                    return downloadSegment();
                } catch (Exception e) {
                    lastException = e;
                    attempts++;
                    System.err.println("Segment " + segmentIndex + " attempt " + attempts + " failed: " + e.getMessage());
                    
                    if (attempts < maxRetries) {
                        // Wait before retry (exponential backoff)
                        Thread.sleep(1000 * attempts);
                    }
                }
            }
            
            System.err.println("Segment " + segmentIndex + " failed after " + maxRetries + " attempts");
            if (lastException != null) {
                throw lastException;
            }
            return false;
        }
        
        private boolean downloadSegment() throws IOException {
            HttpURLConnection connection = (HttpURLConnection) new URL(sourceURL).openConnection();
            connection.setConnectTimeout(connectTimeoutMs);
            connection.setReadTimeout(readTimeoutMs);
            connection.setRequestProperty("Range", "bytes=" + startByte + "-" + endByte);
            
            try {
                int responseCode = connection.getResponseCode();
                if (responseCode != HttpURLConnection.HTTP_PARTIAL && responseCode != HttpURLConnection.HTTP_OK) {
                    throw new IOException("Unexpected response code: " + responseCode);
                }
                
                try (InputStream inputStream = connection.getInputStream();
                     OutputStream outputStream = Files.newOutputStream(segmentFile)) {
                    
                    byte[] buffer = new byte[8192];
                    int bytesRead;
                    long totalBytesRead = 0;
                    long expectedBytes = endByte - startByte + 1;
                    
                    while ((bytesRead = inputStream.read(buffer)) != -1) {
                        outputStream.write(buffer, 0, bytesRead);
                        totalBytesRead += bytesRead;
                        
                        // Avoid downloading more than expected (safety check)
                        if (totalBytesRead >= expectedBytes) {
                            break;
                        }
                    }
                    
                    System.out.println("Segment " + segmentIndex + " completed: " + totalBytesRead + " bytes");
                    return true;
                }
                
            } finally {
                connection.disconnect();
            }
        }
    }
    
    /**
     * Example usage of the ParallelFileDownloader.
     */
    public static void main(String[] args) {
        if (args.length < 2) {
            System.out.println("Usage: java ParallelFileDownloader <source_url> <destination_path> [segment_size_mb]");
            System.exit(1);
        }
        
        String sourceURL = args[0];
        Path destinationPath = Paths.get(args[1]);
        long segmentSizeMB = args.length > 2 ? Long.parseLong(args[2]) : 1; // Default 1MB
        
        ExecutorService executorService = Executors.newFixedThreadPool(8);
        
        try {
            ParallelFileDownloader downloader = new ParallelFileDownloader(
                executorService, 
                10000, // 10 second connect timeout
                30000, // 30 second read timeout
                segmentSizeMB * 1024 * 1024, // Convert MB to bytes
                3 // Max retries
            );
            
            long startTime = System.currentTimeMillis();
            boolean success = downloader.downloadFile(sourceURL, destinationPath);
            long endTime = System.currentTimeMillis();
            
            if (success) {
                System.out.println("Download completed in " + (endTime - startTime) + "ms");
                System.out.println("File size: " + Files.size(destinationPath) + " bytes");
            } else {
                System.err.println("Download failed");
                System.exit(1);
            }
            
        } catch (Exception e) {
            System.err.println("Download error: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        } finally {
            executorService.shutdown();
        }
    }
}
