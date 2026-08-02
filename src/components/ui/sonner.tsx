import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * shadcn ships this wired to `next-themes`. This app is dark-only, so the
 * theme is pinned instead of read from a provider — the rest is upstream.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
