/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.apache.jackrabbit.oak.xpath;


import java.util.regex.Pattern;


/**
 * Utility methods to parse a path.
 * <p>
 * Each method validates the input, except if the system property
 * {packageName}.SKIP_VALIDATION is set, in which case only minimal validation
 * takes place within this function, so when the parameter is an illegal path,
 * the the result of this method is undefined.
 */
public final class PathUtils {

    public static final String ROOT_PATH = "/";
    public static final String ROOT_NAME = "";

    private PathUtils() {
        // utility class
    }


    private static boolean denotesRootPath(String path) {
        return ROOT_PATH.equals(path);
    }

    /**
     * Whether the path is absolute (starts with a slash) or not.
     *
     * @param path the path
     * @return true if it starts with a slash
     */
    public static boolean isAbsolute(String path) {
        assert isValid(path) : "Invalid path ["+path+"]";

        return isAbsolutePath(path);
    }

    private static boolean isAbsolutePath(String path) {
        return !path.isEmpty() && path.charAt(0) == '/';
    }


    /**
     * Concatenate path elements.
     *
     * @param parentPath the parent path
     * @param subPath    the subPath path to add
     * @return the concatenated path
     */
//    @NotNull
    public static String concat(String parentPath, String subPath) {
        assert isValid(parentPath) : "Invalid parent path ["+parentPath+"]";
        assert isValid(subPath) : "Invalid sub path ["+subPath+"]";
        // special cases
        if (parentPath.isEmpty()) {
            return subPath;
        } else if (subPath.isEmpty()) {
            return parentPath;
        } else if (isAbsolutePath(subPath)) {
            throw new IllegalArgumentException("Cannot append absolute path " + subPath);
        }
        String separator = denotesRootPath(parentPath) ? "" : "/";
        return parentPath + separator + subPath;
    }



    /**
     * Check if the path is valid. A valid path is absolute (starts with a '/')
     * or relative (doesn't start with '/'), and contains none or more elements.
     * A path may not end with '/', except for the root path. Elements itself must
     * be at least one character long.
     *
     * @param path the path
     * @return {@code true} iff the path is valid.
     */
    public static boolean isValid(String path) {
        if (path.isEmpty() || denotesRootPath(path)) {
            return true;
        } else if (path.charAt(path.length() - 1) == '/') {
            return false;
        }
        char last = 0;
        for (int index = 0, len = path.length(); index < len; index++) {
            char c = path.charAt(index);
            if (c == '/') {
                if (last == '/') {
                    return false;
                }
            }
            last = c;
        }
        return true;
    }


}
