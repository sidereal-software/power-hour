/** Blurred album-art wash behind the whole app. Purely decorative. */
export function ArtBackdrop({ url }: { url: string }) {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div
        className="absolute -inset-[15%] scale-115 bg-cover bg-center opacity-0 blur-[70px] saturate-150 transition-opacity duration-1000 data-[on=true]:opacity-30"
        data-on={Boolean(url)}
        style={url ? { backgroundImage: `url("${url}")` } : undefined}
      />
      <div className="from-background/0 via-background/60 to-background absolute inset-0 bg-radial" />
    </div>
  )
}
