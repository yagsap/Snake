/**
 * Minimal typed event bus.
 *
 * The prototype's `step()` updated the DOM, played audio, pushed particles and
 * wrote localStorage inline. That couples simulation to presentation: you
 * cannot run a step without a document, and you cannot change the HUD without
 * editing game rules. Here the simulation only emits facts about what
 * happened; audio, HUD, FX and persistence each subscribe to what they care
 * about and stay independent of one another.
 */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<(payload: never) => void>>()

  on<K extends keyof Events>(
    type: K,
    handler: (payload: Events[K]) => void,
  ): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as (payload: never) => void)
    return () => void set.delete(handler as (payload: never) => void)
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type)
    if (!set) return
    // Copy first: a handler is allowed to unsubscribe during dispatch.
    for (const h of [...set]) (h as (p: Events[K]) => void)(payload)
  }

  clear(): void {
    this.handlers.clear()
  }
}
