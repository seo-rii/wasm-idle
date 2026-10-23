import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatJavaDocHtml } from '../src/java/markdown.js';

// Captured by invoking the unchanged original MarkdownHelper's parse,
// replaceNodes and print methods on OpenJDK 17.0.20.1, not by this adapter.
// javacs revision 7fffb6c5929fe02c52e1c823ae990bad2b540ad1.
const originalMarkdownHelperSha256 =
	'2b31b3b038faa2fc97da631c1a2007796cee26030521da0b8cbcdbb4741c3949';
const nativeCases: readonly { name: string; html: string; expected?: string; error?: string }[] = [
	{
		name: 'empty',
		html: '',
		error: 'java.lang.StringIndexOutOfBoundsException'
	},
	{
		name: 'italic',
		html: '<i>  hello  </i>',
		expected: '*hello*'
	},
	{
		name: 'nested italic first',
		html: '<i><b>x</b></i>',
		expected: '*x*'
	},
	{
		name: 'nested bold after italic',
		html: '<b><i>x</i></b>',
		expected: '***x***'
	},
	{
		name: 'pre before code',
		html: '<pre><code> x </code></pre>',
		expected: '`x`'
	},
	{
		name: 'code after pre',
		html: '<code><pre>x</pre></code>',
		expected: '``x``'
	},
	{
		name: 'anchor after bold',
		html: '<a href="https://example.test">  A <b>B</b>  </a>',
		expected: 'A **B**'
	},
	{
		name: 'escaped target text',
		html: '<code>a &lt; b &amp; c &gt; d</code>',
		expected: '`a &lt; b &amp; c &gt; d`'
	},
	{
		name: 'escaped untouched text',
		html: '<span title="A &quot;quoted&quot; &amp; B"> &lt; &gt; &amp; " </span>',
		expected: '<span title="A &quot;quoted&quot; &amp; B"> &lt; &gt; &amp; " </span>'
	},
	{
		name: 'preserved comments',
		html: '<p><!-- comment --><i>x</i></p>',
		expected: '<p><!-- comment -->*x*</p>'
	},
	{
		name: 'CDATA inside target',
		html: '<code><![CDATA[a < b && c > d]]></code>',
		expected: '`a &lt; b &amp;&amp; c &gt; d`'
	},
	{
		name: 'CDATA preserved',
		html: '<p><![CDATA[a < b && c > d]]></p>',
		expected: '<p><![CDATA[a < b && c > d]]></p>'
	},
	{
		name: 'whitespace ASCII',
		html: '<b>\t\n x \r\n</b>',
		expected: '**x**'
	},
	{
		name: 'whitespace NBSP',
		html: '<b>\u00a0x\u00a0</b>',
		expected: '**\u00a0x\u00a0**'
	},
	{
		name: 'unicode NEL and LS',
		html: '<p>a\u0085b\u2028c\u2029d</p>',
		expected: '<p>a&#133;b\u2028c\u2029d</p>'
	},
	{
		name: 'ASCII CR LF',
		html: '<p>a\r\nb\rc</p>',
		expected: '<p>a\nb\nc</p>'
	},
	{
		name: 'empty anchor',
		html: '<a></a>',
		error: 'java.lang.StringIndexOutOfBoundsException'
	},
	{
		name: 'empty preserved',
		html: '<p/>',
		expected: '<p/>'
	},
	{
		name: 'void preserved',
		html: '<p><br/></p>',
		expected: '<p><br/></p>'
	},
	{
		name: 'namespace',
		html: '<x:part><b>x</b></x:part>',
		expected: '<x:part>**x**</x:part>'
	},
	{
		name: 'XML namespace',
		html: '<p xml:space="preserve"><b> x </b></p>',
		expected: '<p xml:space="preserve">**x**</p>'
	},
	{
		name: 'xmlns HTML namespace',
		html: '<p xmlns="http://www.w3.org/1999/xhtml"><br/><b>x</b></p>',
		expected: '<p xmlns="http://www.w3.org/1999/xhtml"><br/>**x**</p>'
	},
	{
		name: 'attribute character references',
		html: '<p title="a&#9;b&#10;c&#13;d">x</p>',
		expected: '<p title="a&#9;b&#10;c&#13;d">x</p>'
	},
	{
		name: 'unquoted attribute',
		html: "<p title='hello'>x</p>",
		expected: '<p title="hello">x</p>'
	},
	{
		name: 'malformed unquoted attribute',
		html: '<p title=hello>x</p>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'malformed dangling ampersand',
		html: '<p>a & b</p>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'malformed unbound entity',
		html: '<p>&nbsp;</p>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'malformed unclosed',
		html: '<b>x',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'malformed mismatched',
		html: '<b>x</i>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'malformed invalid char',
		html: '<p>\u0001</p>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'malformed invalid numeric reference',
		html: '<p>&#0;</p>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'malformed text CDATA close',
		html: '<p>]]></p>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'supplementary Unicode',
		html: '<b>\ud55c\uae00 \ud83d\ude00</b>',
		expected: '**\ud55c\uae00 &#128512;**'
	},
	{
		name: 'uppercase preserved',
		html: '<B>hello</B>',
		expected: '<B>hello</B>'
	},
	{
		name: 'processing instruction',
		html: '<?probe hello?><i>x</i>',
		expected: '<?probe hello?>*x*'
	},
	{
		name: 'nested same tag',
		html: '<i>one<i>two</i>three</i>',
		expected: '*onetwothree*'
	},
	{
		name: 'attribute order',
		html: '<p z="1" a="2" m="3">x</p>',
		expected: '<p a="2" m="3" z="1">x</p>'
	},
	{
		name: 'Unicode attrs comments CDATA',
		html: '<p title="\ud83d\ude00\u0085">\ud83d\ude00<!--\ud83d\ude00\u0085--><![CDATA[\ud83d\ude00\u0085]]></p>',
		expected:
			'<p title="&#128512;\u0085">&#128512;<!--\ud83d\ude00\u0085-->\ud83d\ude00<![CDATA[\u0085]]></p>'
	},
	{
		name: 'text literal controls',
		html: '<p>a\u007fb\u0080c\u009fd</p>',
		expected: '<p>a&#127;b&#128;c&#159;d</p>'
	},
	{
		name: 'text carriage reference',
		html: '<p>a&#13;b</p>',
		expected: '<p>a&#13;b</p>'
	},
	{
		name: 'empty text',
		html: '<a/><i/>',
		expected: '**'
	},
	{
		name: 'anchor comment',
		html: '<a><!--hey--></a>',
		error: 'java.lang.StringIndexOutOfBoundsException'
	},
	{
		name: 'empty CDATA',
		html: '<p><![CDATA[]]></p>',
		expected: '<p/>'
	},
	{
		name: 'empty wrapper comments',
		html: '<!--comment-->',
		expected: '<!--comment-->'
	},
	{
		name: 'empty replaced anchor with p',
		html: '<p><a/></p>',
		expected: '<p/>'
	},
	{
		name: 'FFFD',
		html: '<b>\ufffd</b>',
		expected: '**\ufffd**'
	},
	{
		name: 'target namespace',
		html: '<b xmlns="urn:mine"><i>x</i></b>',
		expected: '***x***'
	},
	{
		name: 'namespace preserved empty',
		html: '<p xmlns="http://www.w3.org/1999/xhtml"/>',
		expected: '<p xmlns="http://www.w3.org/1999/xhtml"/>'
	},
	{
		name: 'malformed duplicateattr',
		html: '<p a="1" a="2">x</p>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'malformed comment',
		html: '<!--a--b--><i>x</i>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'malformed amp',
		html: '<p>&</p>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'reference uppercaseX',
		html: '<p>&#X41;</p>',
		error: 'org.xml.sax.SAXParseException'
	},
	{
		name: 'literal private range',
		html: '<p>\ue000\ufeff\ufffd</p>',
		expected: '<p>\ue000\ufeff\ufffd</p>'
	}
];

describe('original javacs XML documentation boundary', () => {
	it.each(nativeCases)('matches original XML semantics: $name', ({ html, expected, error }) => {
		if (error) expect(() => formatJavaDocHtml(html)).toThrow();
		else expect(formatJavaDocHtml(html)).toBe(expected);
	});

	it(
		'compares every case directly with the unchanged original JVM implementation',
		{
			skip: !process.env.WASM_IDLE_JAVA_MARKDOWN_ORACLE_CLASSPATH,
			timeout: 15_000
		},
		() => {
			const classPath = process.env.WASM_IDLE_JAVA_MARKDOWN_ORACLE_CLASSPATH!;
			const originalSource =
				process.env.WASM_IDLE_JAVA_MARKDOWN_ORACLE_SOURCE ||
				fileURLToPath(
					new URL(
						'../../../.cache/javacs-teavm/javacs/src/main/java/org/javacs/MarkdownHelper.java',
						import.meta.url
					)
				);
			expect(createHash('sha256').update(readFileSync(originalSource)).digest('hex')).toBe(
				originalMarkdownHelperSha256
			);
			const directory = mkdtempSync(path.join(tmpdir(), 'wasm-idle-java-markdown-oracle-'));
			try {
				writeFileSync(
					path.join(directory, 'MarkdownOracle.java'),
					`
import java.lang.reflect.InvocationTargetException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class MarkdownOracle {
  public static void main(String[] args) throws Exception {
    var method = Class.forName("org.javacs.MarkdownHelper").getDeclaredMethod("htmlToMarkdown", String.class);
    method.setAccessible(true);
    for (String arg : args) {
      try {
        var result = (String) method.invoke(null, new String(Base64.getDecoder().decode(arg), StandardCharsets.UTF_8));
        System.out.println("ok\\t" + Base64.getEncoder().encodeToString(result.getBytes(StandardCharsets.UTF_8)));
      } catch (InvocationTargetException error) {
        Throwable cause = error;
        while (cause.getCause() != null) cause = cause.getCause();
        System.out.println("error\\t" + cause.getClass().getName());
      }
    }
  }
}`
				);
				const compile = spawnSync(
					'javac',
					['-d', directory, path.join(directory, 'MarkdownOracle.java')],
					{ encoding: 'utf8', timeout: 5_000 }
				);
				expect(compile.status, compile.stderr).toBe(0);
				const run = spawnSync(
					'java',
					[
						'-cp',
						[directory, classPath].join(path.delimiter),
						'MarkdownOracle',
						...nativeCases.map(({ html }) => Buffer.from(html).toString('base64'))
					],
					{ encoding: 'utf8', timeout: 5_000 }
				);
				expect(run.status, run.stderr).toBe(0);
				const actual = run.stdout
					.trim()
					.split('\n')
					.map((line) => line.split('\t'));
				expect(actual).toHaveLength(nativeCases.length);
				for (const [index, testCase] of nativeCases.entries()) {
					const [kind, value] = actual[index];
					if (testCase.error) {
						expect(kind, testCase.name).toBe('error');
						expect(value, testCase.name).toBe(testCase.error);
						expect(() => formatJavaDocHtml(testCase.html), testCase.name).toThrow();
					} else {
						expect(kind, testCase.name).toBe('ok');
						const expected = Buffer.from(value, 'base64').toString('utf8');
						expect(expected, testCase.name).toBe(testCase.expected);
						expect(formatJavaDocHtml(testCase.html), testCase.name).toBe(expected);
					}
				}
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);
});
