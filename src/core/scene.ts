/**
 * Stack-based scene machine.
 *
 * The prototype tracked screens with three loose booleans (`paused`, `over`,
 * plus a hidden attribute on the menu) and a `wasPaused` variable to remember
 * what to restore after closing the chart. Every new screen multiplied the
 * combinations, and "quit to menu" had to fake `over = true` just to stop the
 * timer.
 *
 * A stack models this properly. Overlays *push* on top of the scene they
 * interrupt instead of mutating it, so the thing underneath is preserved
 * exactly and restored by popping. A scene declares whether the scenes below
 * it keep updating and whether they keep drawing, which is the entire
 * difference between a pause menu (draws below, does not update below) and a
 * heads-up prompt (does both).
 */
export interface Scene {
  readonly name: string
  /** Do scenes below this one keep drawing? Default false. */
  readonly drawsBelow?: boolean
  /** Do scenes below this one keep simulating? Default false. */
  readonly updatesBelow?: boolean

  enter?(): void
  exit?(): void
  /** Called only when this scene is on top, or covered by updatesBelow scenes. */
  update?(dt: number): void
  render?(alpha: number, dt: number): void
}

export class SceneStack {
  private stack: Scene[] = []

  get top(): Scene | undefined {
    return this.stack[this.stack.length - 1]
  }

  get depth(): number {
    return this.stack.length
  }

  has(name: string): boolean {
    return this.stack.some((s) => s.name === name)
  }

  push(scene: Scene): void {
    this.stack.push(scene)
    scene.enter?.()
  }

  pop(): Scene | undefined {
    const scene = this.stack.pop()
    scene?.exit?.()
    return scene
  }

  /** Pop everything, then push `scene`. Used for hard transitions. */
  replaceAll(scene: Scene): void {
    while (this.stack.length) this.pop()
    this.push(scene)
  }

  /** Pop down to and including the named scene. No-op if it isn't present. */
  popTo(name: string): void {
    if (!this.has(name)) return
    while (this.stack.length && this.top?.name !== name) this.pop()
    this.pop()
  }

  /**
   * Update the topmost scene, plus any run of scenes beneath it that the
   * overlays above have explicitly kept alive.
   */
  update(dt: number): void {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      this.stack[i]?.update?.(dt)
      if (!this.stack[i]?.updatesBelow) break
    }
  }

  /**
   * Draw bottom-up so overlays land on top. We first walk down from the top to
   * find the lowest scene that must be drawn, then draw upward from there.
   */
  render(alpha: number, dt: number): void {
    let floor = this.stack.length - 1
    while (floor > 0 && this.stack[floor]?.drawsBelow) floor--
    for (let i = floor; i < this.stack.length; i++) {
      this.stack[i]?.render?.(alpha, dt)
    }
  }
}
