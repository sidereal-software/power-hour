import * as React from 'react'

/** useState that survives a reload. Used to keep game settings between runs. */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored ? ({ ...initial, ...JSON.parse(stored) } as T) : initial
    } catch {
      return initial
    }
  })

  React.useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* private mode / quota — not worth surfacing */
    }
  }, [key, value])

  return [value, setValue] as const
}
