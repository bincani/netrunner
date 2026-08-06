export type CardTextNode =
  | { type: 'text'; value: string }
  | { type: 'icon'; name: string }
  | { type: 'tag'; tag: 'strong' | 'em' | 'ul' | 'li'; children: CardTextNode[] }

type TagNode = Extract<CardTextNode, { type: 'tag' }>

const KNOWN_TAGS = new Set(['strong', 'em', 'ul', 'li'])
const TOKEN_PATTERN = /<(\/?)([a-z]+)>|\[([a-z0-9-]+)\]/g

/**
 * Parses NetrunnerDB-style card text — plain text interleaved with a
 * small set of formatting tags (strong, em, ul, li, no attributes) and
 * [token] icon placeholders — into a tree of text/icon/tag nodes.
 *
 * Any tag outside the known set, or a closing tag with nothing open, is
 * left as literal text rather than rejected: this parses real imported
 * card data, not user input, so gracefully degrading on an unrecognized
 * pattern (e.g. a future icon token) matters more than rejecting it.
 */
export function parseCardText(text: string): CardTextNode[] {
  const root: CardTextNode[] = []
  const stack: TagNode[] = []

  function currentChildren(): CardTextNode[] {
    return stack.length > 0 ? stack[stack.length - 1].children : root
  }

  let lastIndex = 0
  let match: RegExpExecArray | null
  TOKEN_PATTERN.lastIndex = 0

  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      currentChildren().push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }

    const [fullMatch, closing, tagName, token] = match

    if (tagName && KNOWN_TAGS.has(tagName)) {
      if (closing) {
        if (stack.length > 0) stack.pop()
      } else {
        const node: TagNode = { type: 'tag', tag: tagName as TagNode['tag'], children: [] }
        currentChildren().push(node)
        stack.push(node)
      }
    } else if (token) {
      currentChildren().push({ type: 'icon', name: token })
    } else {
      // Matched the tag pattern but not a tag we recognize — keep it as
      // literal text rather than silently dropping it.
      currentChildren().push({ type: 'text', value: fullMatch })
    }

    lastIndex = TOKEN_PATTERN.lastIndex
  }

  if (lastIndex < text.length) {
    currentChildren().push({ type: 'text', value: text.slice(lastIndex) })
  }

  return root
}
