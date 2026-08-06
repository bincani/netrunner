import { parseCardText, type CardTextNode } from '@/lib/cardText'

const ICON_LABELS: Record<string, string> = {
  credit: 'credit',
  click: 'click',
  trash: 'trash',
  subroutine: 'subroutine',
}

function renderNodes(nodes: CardTextNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`

    if (node.type === 'text') {
      return node.value
    }

    if (node.type === 'icon') {
      const label = ICON_LABELS[node.name]
      // A token outside the required set (e.g. "[mu]") isn't an icon this
      // renderer knows how to draw — show it back as the literal text it
      // would otherwise have been, rather than a blank/broken icon.
      if (!label) {
        return `[${node.name}]`
      }
      return <span key={key} role="img" aria-label={label} className={`card-icon card-icon-${node.name}`} />
    }

    const children = renderNodes(node.children, `${key}-`)
    switch (node.tag) {
      case 'strong':
        return <strong key={key}>{children}</strong>
      case 'em':
        return <em key={key}>{children}</em>
      case 'ul':
        return (
          <ul key={key} className="list-disc space-y-0.5 pl-5">
            {children}
          </ul>
        )
      case 'li':
        return <li key={key}>{children}</li>
    }
  })
}

/** Renders NetrunnerDB-style card text — formatting tags and [token] icon placeholders — as real elements, not raw HTML. */
export function CardText({ text }: { text: string }) {
  return <>{renderNodes(parseCardText(text), 'n')}</>
}
