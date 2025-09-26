import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Standalone converter of the JavaScript logic in docs/indexDefAnalyzer.html to Java.
 *
 * Notes:
 * - JSON is parsed minimally without external libs into JsonObj trees.
 * - Arrays are preserved as JSON strings in properties (e.g., properties.get("includedPaths")).
 * - Methods mirror the JS helpers: isPlainObject, isEmptyObject, cleanupAndConvertToLucene, deepDiff, analyze.
 */
public class IndexDefAnalyzer {
	public static class JsonObj {
		public final LinkedHashMap<String, JsonObj> children = new LinkedHashMap<>();
		public final LinkedHashMap<String, String> properties = new LinkedHashMap<>();

		public boolean isEmpty() {
			return children.isEmpty() && properties.isEmpty();
		}
	}

	// --------------- Public API ---------------

	/**
	 * Analyze input JSON (same semantics as the JS analyze() function) and return a JSON string.
	 */
	public static String analyze(String jsonInput) {
		if (jsonInput == null) {
			jsonInput = "";
		}
		jsonInput = jsonInput.trim();
		if (jsonInput.isEmpty()) {
			// Use the example JSON from the HTML page if input is empty
			jsonInput = "{\n" +
					"  \"/oak:index/acPrincipalName\": {\n" +
					"    \"reindex\": false\n" +
					"  },\n" +
					"  \"/oak:index/acme.cqPageLucene-custom-1\": {\n" +
					"    \"seed\": -6195042258826211745\n" +
					"  },\n" +
					"  \"/oak:index/acme.ntHierarchyLucene-custom-1\": {\n" +
					"    \"includedPaths\": [\"/apps\", \"/conf\", \"/content\", \"/etc\", \"/home\", \"/var\"]\n" +
					"  },\n" +
					"  \"/oak:index/aceDestinationFragments-custom-1\": {\n" +
					"    \"includedPaths\": [\"/content/dam\"]\n" +
					"  }\n" +
					"}";
		}

		// Parse root object
		JsonObj root = parse(jsonInput);
		// Build a mutable LinkedHashMap of the top-level entries (key -> JsonObj)
		LinkedHashMap<String, JsonObj> obj = new LinkedHashMap<>(root.children);

		// Cleanup and Convert To Lucene
		List<String> topKeys = new ArrayList<>(obj.keySet());
		for (String k : topKeys) {
			JsonObj value = obj.get(k);
			value = cleanupAndConvertToLucene(0, value);
			List<String> inc = getIncludedPaths(value);
			if (inc.size() == 1 && "/dummy".equals(inc.get(0))) {
				obj.remove(k);
				continue;
			}
			String type = value.properties.get("type");
			if ("disabled".equals(type)) {
				obj.remove(k);
				continue;
			}
			obj.put(k, value);
		}

		// Only process direct children keys that include '-custom-' or contain a dot
		List<String> keys = new ArrayList<>();
		for (String k : obj.keySet()) {
			boolean isDirectChild = k.startsWith("/oak:index/");
			boolean hasCustom = k.contains("-custom-");
			boolean hasDot = k.contains(".");
			if (isDirectChild && (hasCustom || hasDot)) {
				keys.add(k);
			}
		}

		// Build entries with normalized includedPaths
		class Entry {
			final String key;
			final List<String> includedPaths;
			String baseVersion; // optional
			JsonObj indexRules; // optional
			Entry(String key, List<String> includedPaths) {
				this.key = key;
				this.includedPaths = includedPaths;
			}
		}
		List<Entry> entries = new ArrayList<>();
		for (String k : keys) {
			JsonObj def = obj.getOrDefault(k, new JsonObj());
			List<String> paths = getIncludedPaths(def);
			if (paths.isEmpty()) {
				paths = Collections.singletonList("/");
			}
			entries.add(new Entry(k, paths));
		}

		List<String> indexesThatContainsAppsOrLibs = new ArrayList<>();

		// Filter out entries that have root or libs/apps paths
		List<Entry> filtered = new ArrayList<>();
		for (Entry e : entries) {
			List<String> paths = e.includedPaths;
			boolean hasRoot = paths.contains("/");
			boolean hasApp = paths.contains("/apps");
			boolean hasLibs = paths.contains("/libs");
			boolean hasAppsPrefix = anyStartsWith(paths, "/apps/");
			boolean hasLibsPrefix = anyStartsWith(paths, "/libs/");
			boolean containsAppsOrLibs = hasRoot || hasApp || hasLibs || hasAppsPrefix || hasLibsPrefix;
			if (containsAppsOrLibs) {
				indexesThatContainsAppsOrLibs.add(e.key);
			} else {
				filtered.add(e);
			}
		}

		// Natural sort by key
		filtered.sort(naturalEntryComparator());

		// Keep only latest per prefix (part before first '-')
		LinkedHashMap<String, Entry> prefixToEntry = new LinkedHashMap<>();
		for (Entry e : filtered) {
			String key = e.key;
			int dashIndex = key.indexOf('-');
			String prefix = dashIndex == -1 ? key : key.substring(0, dashIndex);
			prefixToEntry.put(prefix, e); // later wins
		}

		List<Entry> selected = new ArrayList<>(prefixToEntry.values());
		selected.sort(naturalEntryComparator());

		// Attach baseVersion where present
		Pattern basePat = Pattern.compile("^(.*)-custom-\\d+$");
		for (Entry e : selected) {
			Matcher m = basePat.matcher(e.key);
			if (m.matches()) {
				String baseKey = m.group(1);
				if (obj.containsKey(baseKey)) {
					e.baseVersion = baseKey;
				}
			}
		}

		// Compute diffs against base where applicable
		for (Entry e : selected) {
			if (e.baseVersion != null && obj.containsKey(e.baseVersion)) {
				JsonObj baseObj = obj.get(e.baseVersion);
				JsonObj currObj = obj.get(e.key);
				JsonObj diff = deepDiff(0, baseObj, currObj, "added");
				JsonObj indexRulesAdded = diff.children.get("indexRules");
				if (indexRulesAdded != null && !indexRulesAdded.isEmpty()) {
					e.indexRules = indexRulesAdded;
				}
			}
		}

		// Assemble result as JsonObj for clean JSON serialization
		JsonObj result = new JsonObj();

		for (Entry e : selected) {
			JsonObj v = new JsonObj();
			if (e.indexRules != null && !e.indexRules.isEmpty()) {
				v.children.put("indexRules", e.indexRules);
			}
			if (!v.isEmpty()) {
				String base = e.key.substring(0, e.key.indexOf('-'));
				String k2 = base.replace("/oak:index/", "");
				result.children.put(k2, v);
			}
		}

		// Fully custom indexes (without base version)
		Set<String> selectedKeys = new LinkedHashSet<>();
		for (Entry e : selected) {
			selectedKeys.add(e.key);
		}
		for (Entry e : filtered) {
			if (!selectedKeys.contains(e.key)) {
				continue; // shouldn't happen, but keep safe
			}
		}
		for (Entry e : filtered) {
			boolean hasBase = false;
			Matcher m = basePat.matcher(e.key);
			if (m.matches()) {
				hasBase = obj.containsKey(m.group(1));
			}
			if (hasBase) {
				continue;
			}
			String k2 = e.key;
			if (k2.startsWith("/oak:index/")) {
				k2 = k2.substring("/oak:index/".length());
			}
			String base = k2.substring(0, k2.indexOf('-'));
			if (result.children.containsKey(base)) {
				continue;
			}
			JsonObj value = obj.get(e.key);
			List<String> inc = getIncludedPaths(value);
			if (inc.size() == 1 && "/dummy".equals(inc.get(0))) {
				continue;
			}
			String outKey = base;
			if (outKey.indexOf('.') < 0) {
				outKey = "custom." + outKey;
			}
			result.children.put(outKey, value);
		}

		if (!indexesThatContainsAppsOrLibs.isEmpty()) {
			result.properties.put(
					"indexesThatContainsAppsOrLibs",
					toJsonArrayString(indexesThatContainsAppsOrLibs));
		}

		return toJsonString(result);
	}

	// --------------- JS helper equivalents ---------------

	public static boolean isPlainObject(JsonObj value) {
		return value != null;
	}

	public static boolean isEmptyObject(JsonObj obj) {
		return obj == null || (obj.children.isEmpty() && obj.properties.isEmpty());
	}

	public static JsonObj cleanupAndConvertToLucene(int level, JsonObj v) {
		if (v == null) {
			return null;
		}
		// Process properties
		List<String> propKeys = new ArrayList<>(v.properties.keySet());
		for (String key : propKeys) {
			String value = v.properties.get(key);
			if (value != null && (value.startsWith("str:") || value.startsWith("dat:"))) {
				v.properties.put(key, value.substring(4));
			}
			if ("jcr:uuid".equals(key) || "jcr:primaryType".equals(key)) {
				v.properties.remove(key);
				continue;
			}
			if (level == 0) {
				if (key.startsWith(":" )
						|| key.equals("seed")
						|| key.equals("merges")
						|| key.equals("reindexCount")
						|| key.equals("refresh")
						|| key.equals("originalType")
						|| key.equals("reindex")) {
					v.properties.remove(key);
					continue;
				}
			}
			if (key.endsWith("@lucene")) {
				String k2 = key.substring(0, key.length() - "@lucene".length());
				v.properties.put(k2, value);
				v.properties.remove(key);
			}
		}
		// Process children
		List<String> childKeys = new ArrayList<>(v.children.keySet());
		for (String key : childKeys) {
			if ("jcr:uuid".equals(key) || "jcr:primaryType".equals(key)) {
				v.children.remove(key);
				continue;
			}
			if (key.endsWith("@lucene")) {
				JsonObj child = v.children.remove(key);
				String k2 = key.substring(0, key.length() - "@lucene".length());
				v.children.put(k2, child);
			}
			JsonObj cleaned = cleanupAndConvertToLucene(level + 1, v.children.get(key));
			v.children.put(key, cleaned);
		}
		return v;
	}

	/**
	 * Deep diff between base and current objects, producing hierarchical added/removed/changed.
	 * Only 'added' is needed for analyze(), but other types are partly implemented.
	 */
	public static JsonObj deepDiff(int level, JsonObj base, JsonObj current, String type) {
		JsonObj result = new JsonObj();

		Set<String> keys = new LinkedHashSet<>();
		keys.addAll(keyUnion(base));
		keys.addAll(keyUnion(current));

		for (String key : keys) {
			boolean inBase = containsKey(base, key);
			boolean inCurr = containsKey(current, key);

			JsonObj baseChild = base != null ? base.children.get(key) : null;
			JsonObj currChild = current != null ? current.children.get(key) : null;
			String baseProp = base != null ? base.properties.get(key) : null;
			String currProp = current != null ? current.properties.get(key) : null;

			if (!inBase && inCurr && "added".equals(type)) {
				if (currChild != null) {
					result.children.put(key, currChild);
				} else if (currProp != null) {
					result.properties.put(key, currProp);
				}
				continue;
			}
			if (inBase && !inCurr && "removed".equals(type)) {
				result.children.put(key, new JsonObj());
				continue;
			}

			// Both present
			if (baseChild != null && currChild != null) {
				JsonObj sub = deepDiff(level + 1, baseChild, currChild, type);
				if (!sub.isEmpty()) {
					result.children.put(key, sub);
				}
			}
			if ("changed".equals(type)) {
				boolean equalProps = Objects.equals(baseProp, currProp);
				if (!equalProps && baseProp != null && currProp != null) {
					result.properties.put(key, "true");
				}
			}
		}
		if (result.isEmpty()) return new JsonObj();
		return result;
	}

	// --------------- Internal helpers ---------------

	private static boolean anyStartsWith(List<String> items, String prefix) {
		for (String p : items) {
			if (p != null && p.startsWith(prefix)) return true;
		}
		return false;
	}

	private static Comparator<Entry> naturalEntryComparator() {
		return (a, b) -> naturalCompare(a.key, b.key);
	}

	private static int naturalCompare(String a, String b) {
		int ia = 0, ib = 0;
		int na = a.length(), nb = b.length();
		while (ia < na && ib < nb) {
			char ca = a.charAt(ia);
			char cb = b.charAt(ib);
			if (Character.isDigit(ca) && Character.isDigit(cb)) {
				int sa = ia; while (ia < na && Character.isDigit(a.charAt(ia))) ia++;
				int sb = ib; while (ib < nb && Character.isDigit(b.charAt(ib))) ib++;
				String da = a.substring(sa, ia);
				String db = b.substring(sb, ib);
				int va = Integer.parseInt(da);
				int vb = Integer.parseInt(db);
				if (va != vb) return Integer.compare(va, vb);
			} else {
				int cmp = Character.toString(ca).compareToIgnoreCase(Character.toString(cb));
				if (cmp != 0) return cmp;
				ia++; ib++;
			}
		}
		return Integer.compare(na - ia, nb - ib);
	}

	private static Set<String> keyUnion(JsonObj o) {
		LinkedHashSet<String> s = new LinkedHashSet<>();
		if (o == null) return s;
		s.addAll(o.children.keySet());
		s.addAll(o.properties.keySet());
		return s;
	}

	private static boolean containsKey(JsonObj o, String key) {
		if (o == null) return false;
		return o.children.containsKey(key) || o.properties.containsKey(key);
	}

	private static List<String> getIncludedPaths(JsonObj obj) {
		String v = obj != null ? obj.properties.get("includedPaths") : null;
		if (v == null) {
			return Collections.emptyList();
		}
		v = v.trim();
		if (v.startsWith("[")) {
			return parseStringArray(v);
		}
		return Collections.singletonList(v);
	}

	private static List<String> parseStringArray(String jsonArray) {
		// minimal parser for a JSON array of strings
		ArrayList<String> out = new ArrayList<>();
		int i = 0, n = jsonArray.length();
		while (i < n && Character.isWhitespace(jsonArray.charAt(i))) i++;
		if (i >= n || jsonArray.charAt(i) != '[') return out;
		i++;
		while (true) {
			while (i < n && Character.isWhitespace(jsonArray.charAt(i))) i++;
			if (i < n && jsonArray.charAt(i) == ']') { i++; break; }
			if (i >= n) break;
			if (jsonArray.charAt(i) == '"') {
				int[] res = parseJsonString(jsonArray, i);
				out.add(unescapeJson(jsonArray.substring(res[0], res[1])));
				i = res[2];
			} else {
				// non-string element: read until comma or ]
				int start = i;
				int depth = 0;
				while (i < n) {
					char c = jsonArray.charAt(i);
					if (c == '"') {
						int[] res = parseJsonString(jsonArray, i);
						i = res[2];
						continue;
					}
					if (c == '[' || c == '{') depth++;
					if (c == ']' || c == '}') { if (depth == 0) break; depth--; }
					if (depth == 0 && c == ',') break;
					i++;
				}
				String raw = jsonArray.substring(start, i).trim();
				out.add(raw);
			}
			while (i < n && Character.isWhitespace(jsonArray.charAt(i))) i++;
			if (i < n && jsonArray.charAt(i) == ',') { i++; continue; }
			if (i < n && jsonArray.charAt(i) == ']') { i++; break; }
			if (i >= n) break;
		}
		return out;
	}

	private static int[] parseJsonString(CharSequence s, int startQuoteIdx) {
		int i = startQuoteIdx + 1;
		int n = s.length();
		StringBuilder sb = new StringBuilder();
		int begin = i;
		while (i < n) {
			char c = s.charAt(i);
			if (c == '\\') {
				i += 2;
				continue;
			}
			if (c == '"') {
				int contentStart = begin;
				int contentEnd = i;
				return new int[] { contentStart, contentEnd, i + 1 };
			}
			i++;
		}
		return new int[] { startQuoteIdx + 1, n, n };
	}

	private static String unescapeJson(String s) {
		StringBuilder out = new StringBuilder(s.length());
		for (int i = 0; i < s.length(); i++) {
			char c = s.charAt(i);
			if (c == '\\' && i + 1 < s.length()) {
				char n = s.charAt(i + 1);
				switch (n) {
					case '"': out.append('"'); break;
					case '\\': out.append('\\'); break;
					case '/': out.append('/'); break;
					case 'b': out.append('\b'); break;
					case 'f': out.append('\f'); break;
					case 'n': out.append('\n'); break;
					case 'r': out.append('\r'); break;
					case 't': out.append('\t'); break;
					case 'u':
						if (i + 5 < s.length()) {
							String hex = s.substring(i + 2, i + 6);
							out.append((char) Integer.parseInt(hex, 16));
							i += 4;
						}
						break;
					default:
						out.append(n);
				}
				i++;
			} else {
				out.append(c);
			}
		}
		return out.toString();
	}

	private static String toJsonString(JsonObj obj) {
		StringBuilder sb = new StringBuilder();
		sb.append('{');
		boolean first = true;
		// properties first, then children
		for (Map.Entry<String, String> e : obj.properties.entrySet()) {
			if (!first) sb.append(',');
			first = false;
			appendJsonString(sb, e.getKey());
			sb.append(':');
			String v = e.getValue();
			if (v != null && v.startsWith("[")) {
				// value is a JSON array string we already hold
				sb.append(v);
			} else if (v != null && looksLikeJsonObject(v)) {
				// already JSON object string
				sb.append(v);
			} else if (v == null || "null".equals(v)) {
				sb.append("null");
			} else if (isNumeric(v) || isBooleanLiteral(v)) {
				sb.append(v);
			} else {
				appendJsonString(sb, v);
			}
		}
		for (Map.Entry<String, JsonObj> e : obj.children.entrySet()) {
			if (!first) sb.append(',');
			first = false;
			appendJsonString(sb, e.getKey());
			sb.append(':');
			sb.append(toJsonString(e.getValue()));
		}
		sb.append('}');
		return sb.toString();
	}

	private static void appendJsonString(StringBuilder sb, String s) {
		sb.append('"');
		for (int i = 0; i < s.length(); i++) {
			char c = s.charAt(i);
			switch (c) {
				case '"': sb.append("\\\""); break;
				case '\\': sb.append("\\\\"); break;
				case '\b': sb.append("\\b"); break;
				case '\f': sb.append("\\f"); break;
				case '\n': sb.append("\\n"); break;
				case '\r': sb.append("\\r"); break;
				case '\t': sb.append("\\t"); break;
				default:
					if (c < 0x20) {
						sb.append(String.format("\\u%04x", (int) c));
					} else {
						sb.append(c);
					}
			}
		}
		sb.append('"');
	}

	private static boolean looksLikeJsonObject(String v) {
		String t = v.trim();
		return t.startsWith("{") && t.endsWith("}");
	}

	private static boolean isNumeric(String s) {
		if (s == null || s.isEmpty()) return false;
		int i = 0; if (s.charAt(0) == '-' || s.charAt(0) == '+') i++;
		boolean dot = false, digit = false;
		for (; i < s.length(); i++) {
			char c = s.charAt(i);
			if (c >= '0' && c <= '9') { digit = true; continue; }
			if (c == '.' && !dot) { dot = true; continue; }
			if (c == 'e' || c == 'E') { return digit; }
			return false;
		}
		return digit;
	}

	private static boolean isBooleanLiteral(String s) {
		return "true".equals(s) || "false".equals(s);
	}

	private static String toJsonArrayString(List<String> items) {
		StringBuilder sb = new StringBuilder();
		sb.append('[');
		for (int i = 0; i < items.size(); i++) {
			if (i > 0) sb.append(',');
			appendJsonString(sb, items.get(i));
		}
		sb.append(']');
		return sb.toString();
	}

	// --------------- Minimal JSON parser (object-focused) ---------------

	public static JsonObj parse(String json) {
		return new Parser(json).parseObject();
	}

	private static final class Parser {
		private final String s;
		private int i = 0;
		Parser(String s) { this.s = s; }

		JsonObj parseObject() {
			skipWs();
			if (peek() != '{') throw error("Expected '{'");
			i++;
			JsonObj obj = new JsonObj();
			skipWs();
			if (peek() == '}') { i++; return obj; }
			while (true) {
				skipWs();
				String key = parseString();
				skipWs();
				expect(':');
				skipWs();
				char c = peek();
				if (c == '{') {
					JsonObj child = parseObject();
					obj.children.put(key, child);
				} else if (c == '[') {
					String arr = parseArrayAsJson();
					obj.properties.put(key, arr);
				} else if (c == '"') {
					String str = parseString();
					obj.properties.put(key, str);
				} else if (startsWith("true")) {
					consume("true");
					obj.properties.put(key, "true");
				} else if (startsWith("false")) {
					consume("false");
					obj.properties.put(key, "false");
				} else if (startsWith("null")) {
					consume("null");
					obj.properties.put(key, "null");
				} else {
					String num = parseNumberLiteral();
					obj.properties.put(key, num);
				}
				skipWs();
				char sep = peek();
				if (sep == ',') { i++; continue; }
				if (sep == '}') { i++; break; }
				throw error("Expected ',' or '}'");
			}
			return obj;
		}

		private String parseArrayAsJson() {
			int start = i;
			int depth = 0;
			boolean inStr = false;
			char prev = 0;
			while (i < s.length()) {
				char c = s.charAt(i++);
				if (inStr) {
					if (c == '"' && prev != '\\') { inStr = false; }
					prev = c;
					continue;
				}
				if (c == '"') { inStr = true; prev = 0; continue; }
				if (c == '[') depth++;
				if (c == ']') { depth--; if (depth == 0) break; }
			}
			String raw = s.substring(start, i);
			return raw;
		}

		private String parseString() {
			if (peek() != '"') throw error("Expected '" + '"' + "'");
			i++;
			StringBuilder out = new StringBuilder();
			while (i < s.length()) {
				char c = s.charAt(i++);
				if (c == '"') break;
				if (c == '\\') {
					if (i >= s.length()) break;
					char n = s.charAt(i++);
					switch (n) {
						case '"': out.append('"'); break;
						case '\\': out.append('\\'); break;
						case '/': out.append('/'); break;
						case 'b': out.append('\b'); break;
						case 'f': out.append('\f'); break;
						case 'n': out.append('\n'); break;
						case 'r': out.append('\r'); break;
						case 't': out.append('\t'); break;
						case 'u':
							if (i + 3 < s.length()) {
								String hex = s.substring(i, i + 4);
								out.append((char) Integer.parseInt(hex, 16));
								i += 4;
							}
							break;
						default: out.append(n);
					}
				} else {
					out.append(c);
				}
			}
			return out.toString();
		}

		private String parseNumberLiteral() {
			int start = i;
			if (peek() == '-' || peek() == '+') i++;
			while (i < s.length()) {
				char c = s.charAt(i);
				if ((c >= '0' && c <= '9')) { i++; continue; }
				if (c == '.') { i++; continue; }
				if (c == 'e' || c == 'E') { i++; if (i < s.length() && (s.charAt(i) == '+' || s.charAt(i) == '-')) i++; continue; }
				break;
			}
			return s.substring(start, i);
		}

		private void skipWs() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
		private char peek() { return i < s.length() ? s.charAt(i) : (char) -1; }
		private void expect(char c) { if (peek() != c) throw error("Expected '" + c + "'"); i++; }
		private boolean startsWith(String t) { return s.startsWith(t, i); }
		private void consume(String t) { if (!startsWith(t)) throw error("Expected '" + t + "'"); i += t.length(); }
		private RuntimeException error(String msg) { return new RuntimeException(msg + " at pos " + i); }
	}

	// --------------- Simple CLI for manual test ---------------

	public static void main(String[] args) {
		String input = args != null && args.length > 0 ? String.join(" ", Arrays.asList(args)) : "";
		System.out.println(analyze(input));
	}
}
