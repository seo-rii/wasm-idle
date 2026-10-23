import { DOMImplementation, XMLSerializer, type Node } from '@xmldom/xmldom';
import { SaxesParser } from 'saxes';

/** The XML DOM boundary of upstream javacs MarkdownHelper.htmlToMarkdown. */
export function formatJavaDocHtml(html: string): string {
	const document = new DOMImplementation().createDocument(null, '');
	let parent: Node = document;
	// The original DocumentBuilder is XML 1.0 with namespace awareness disabled.
	// Saxes supplies strict parsing; xmldom supplies the actual mutable XML DOM.
	const parser = new SaxesParser({
		xmlns: false,
		defaultXMLVersion: '1.0',
		forceXMLVersion: true
	});
	parser.on('opentag', (tag) => {
		const element = document.createElement(tag.name);
		// Xerces' namespace-unaware NamedNodeMap iterates attributes by name.
		for (const name of Object.keys(tag.attributes).sort()) {
			element.setAttribute(name, tag.attributes[name]);
		}
		parent.appendChild(element);
		parent = element;
	});
	parser.on('closetag', () => {
		parent = parent.parentNode!;
	});
	parser.on('text', (text) => {
		if (text) parent.appendChild(document.createTextNode(text));
	});
	parser.on('cdata', (text) => {
		if (text) parent.appendChild(document.createCDATASection(text));
	});
	parser.on('comment', (text) => parent.appendChild(document.createComment(text)));
	parser.on('processinginstruction', ({ target, body }) => {
		parent.appendChild(document.createProcessingInstruction(target, body));
	});
	parser.write(`<wrapper>${html}</wrapper>`).close();

	for (const [tag, delimiter] of [
		['i', '*'],
		['b', '**'],
		['pre', '`'],
		['code', '`'],
		['a', '']
	] as const) {
		// Upstream always replaces the first matching node, then obtains a new list.
		// Processing a parent therefore discards any matching descendants of it.
		let node = document.getElementsByTagName(tag).item(0);
		while (node) {
			// Java String.trim only removes characters <= U+0020, including ASCII controls.
			const contents = (node.textContent || '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/gu, '');
			const text = `${delimiter}${contents}${delimiter}`;
			if (text) node.parentNode!.replaceChild(document.createTextNode(text), node);
			else node.parentNode!.removeChild(node);
			node = document.getElementsByTagName(tag).item(0);
		}
	}

	const serializer = new XMLSerializer();
	// xmldom 0.9.12 supports serialized strings from its nodeFilter at runtime;
	// its declaration only exposes Node results. This keeps the JDK Transformer's
	// character-reference conventions while the library serializes the XML tree.
	const filteredSerializer = serializer as unknown as {
		serializeToString(
			node: Node,
			options: { nodeFilter: (node: Node) => Node | string }
		): string;
	};
	const wrapped = filteredSerializer.serializeToString(document, {
		nodeFilter: (node) => {
			if (node.nodeType === node.TEXT_NODE || node.nodeType === node.ATTRIBUTE_NODE) {
				const escaped = serializer.serializeToString(node);
				const references =
					node.nodeType === node.TEXT_NODE
						? /[\r\u007f-\u009f\u{10000}-\u{10ffff}]/gu
						: /[\u{10000}-\u{10ffff}]/gu;
				return escaped.replace(references, (character) => `&#${character.codePointAt(0)};`);
			}
			if (node.nodeType === node.CDATA_SECTION_NODE) {
				// The JDK opens a CDATA section at its first BMP character. Leading
				// supplementary characters are written as ordinary Unicode instead.
				const text = node.nodeValue!;
				const leading = text.match(/^[\u{10000}-\u{10ffff}]+/u)?.[0] || '';
				if (leading) {
					const remainder = text.slice(leading.length);
					return (
						leading +
						(remainder
							? serializer.serializeToString(document.createCDATASection(remainder))
							: '')
					);
				}
			}
			return node;
		}
	});
	// The original substring operation also fails for an empty <wrapper/>.
	if (!wrapped.startsWith('<wrapper>') || !wrapped.endsWith('</wrapper>')) {
		throw new Error('Original javacs cannot serialize an empty HTML wrapper');
	}
	return wrapped.slice('<wrapper>'.length, -'</wrapper>'.length);
}
