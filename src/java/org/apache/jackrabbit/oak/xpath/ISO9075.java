package org.apache.jackrabbit.oak.xpath;

import java.util.regex.Matcher;
import java.util.regex.Pattern;


public class ISO9075 {
    
    /** Pattern on an encoded character */
    private static final Pattern ENCODE_PATTERN = Pattern.compile("_x\\p{XDigit}{4}_");
    
    /** All the possible hex digits */
    private static final String HEX_DIGITS = "0123456789abcdefABCDEF";
    
    private static final char[] PADDING = new char[] {'0', '0', '0'};
    
    private static void encode(char c, StringBuffer b) {
        b.append("_x");
        String hex = Integer.toHexString(c);
        b.append(PADDING, 0, 4 - hex.length());
        b.append(hex);
        b.append("_");
    }
    
    public static String encode(String name) {
        // quick check for root node name
        if (name.length() == 0) {
            return name;
        }
        if (XMLChar.isValidName(name) && name.indexOf("_x") < 0) {
            // already valid
            return name;
        } else {
            // encode
            StringBuffer encoded = new StringBuffer();
            for (int i = 0; i < name.length(); i++) {
                if (i == 0) {
                    // first character of name
                    if (XMLChar.isNameStart(name.charAt(i))) {
                        if (needsEscaping(name, i)) {
                            // '_x' must be encoded
                            encode('_', encoded);
                        } else {
                            encoded.append(name.charAt(i));
                        }
                    } else {
                        // not valid as first character -> encode
                        encode(name.charAt(i), encoded);
                    }
                } else if (!XMLChar.isName(name.charAt(i))) {
                    encode(name.charAt(i), encoded);
                } else {
                    if (needsEscaping(name, i)) {
                        // '_x' must be encoded
                        encode('_', encoded);
                    } else {
                        encoded.append(name.charAt(i));
                    }
                }
            }
            return encoded.toString();
        }
    }
    
    public static String decode(String name) {
        // quick check
        if (name.indexOf("_x") < 0) {
            // not encoded
            return name;
        }
        StringBuffer decoded = new StringBuffer();
        Matcher m = ENCODE_PATTERN.matcher(name);
        while (m.find()) {
            char ch = (char) Integer.parseInt(m.group().substring(2, 6), 16);
            if (ch == '$' || ch == '\\') {
                m.appendReplacement(decoded, "\\" + ch);
            } else {
                m.appendReplacement(decoded, Character.toString(ch));
            }
        }
        m.appendTail(decoded);
        return decoded.toString();
    }
    
    /**
     * Returns true if <code>name.charAt(location)</code> is the underscore
     * character and the following character sequence is 'xHHHH_' where H
     * is a hex digit.
     * @param name the name to check.
     * @param location the location to look at.
     * @throws ArrayIndexOutOfBoundsException if location > name.length()
     */
    private static boolean needsEscaping(String name, int location)
            throws ArrayIndexOutOfBoundsException {
        if (name.charAt(location) == '_' && name.length() >= location + 6) {
            return name.charAt(location + 1) == 'x'
                && HEX_DIGITS.indexOf(name.charAt(location + 2)) != -1
                && HEX_DIGITS.indexOf(name.charAt(location + 3)) != -1
                && HEX_DIGITS.indexOf(name.charAt(location + 4)) != -1
                && HEX_DIGITS.indexOf(name.charAt(location + 5)) != -1;
        } else {
            return false;
        }
    }
}

