package org.apache.jackrabbit.oak.xpath;

import java.util.Arrays;

/**
 * Simplified XMLChar utility class that provides XML name validation.
 * Only contains the functionality actually used in the codebase.
 */
public class XMLChar {

    /** Character flags array */
    private static final byte[] CHARS = new byte[1 << 16];

    /** Name start character mask */
    public static final int MASK_NAME_START = 0x04;

    /** Name character mask */
    public static final int MASK_NAME = 0x08;

    // Static initialization - only set flags for name start and name characters
    static {
        // Basic ASCII letters (A-Z, a-z)
        Arrays.fill(CHARS, 65, 91, (byte) (MASK_NAME_START | MASK_NAME));   // A-Z
        Arrays.fill(CHARS, 97, 123, (byte) (MASK_NAME_START | MASK_NAME));  // a-z
        
        // Underscore and colon can start names
        CHARS[95] = (byte) (MASK_NAME_START | MASK_NAME);   // _
        CHARS[58] = (byte) (MASK_NAME_START | MASK_NAME);   // :
        
        // Digits and other characters that can be in names (but not start them)
        Arrays.fill(CHARS, 48, 58, (byte) MASK_NAME);       // 0-9
        CHARS[45] = (byte) MASK_NAME;                        // -
        CHARS[46] = (byte) MASK_NAME;                        // .
        CHARS[183] = (byte) MASK_NAME;                       // ·
        
        // Extended Unicode ranges for international characters
        // Latin Extended (most common international characters)
        Arrays.fill(CHARS, 192, 247, (byte) (MASK_NAME_START | MASK_NAME));  // À-ö
        Arrays.fill(CHARS, 248, 383, (byte) (MASK_NAME_START | MASK_NAME));  // ø-ÿ and extended
        
        // Additional combining characters that can appear in names
        Arrays.fill(CHARS, 768, 838, (byte) MASK_NAME);     // Combining diacritical marks
    }

    /**
     * Returns true if the specified character is a valid name start
     * character as defined by XML 1.0 specification.
     */
    public static boolean isNameStart(int c) {
        return c < 0x10000 && (CHARS[c] & MASK_NAME_START) != 0;
    }

    /**
     * Returns true if the specified character is a valid name
     * character as defined by XML 1.0 specification.
     */
    public static boolean isName(int c) {
        return c < 0x10000 && (CHARS[c] & MASK_NAME) != 0;
    }

    /**
     * Check if a string is a valid XML Name.
     * A Name must start with a name start character followed by name characters.
     */
    public static boolean isValidName(String name) {
        final int length = name.length();
        if (length == 0) {
            return false;
        }
        
        // First character must be a name start character
        char ch = name.charAt(0);
        if (!isNameStart(ch)) {
            return false;
        }
        
        // Remaining characters must be name characters
        for (int i = 1; i < length; ++i) {
            ch = name.charAt(i);
            if (!isName(ch)) {
                return false;
            }
        }
        return true;
    }
}

