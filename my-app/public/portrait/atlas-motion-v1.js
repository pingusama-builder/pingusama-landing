export const INVITATION_STORAGE_KEY = "portrait-atlas-invitation-seen-v1"

export function getInitialInvitationState({
  reducedMotion,
  seenThisSession,
}) {
  return reducedMotion || seenThisSession ? "threshold" : "working"
}

export function phaseForElapsed(elapsedMs) {
  if (elapsedMs < 3_000) return "working"
  if (elapsedMs < 3_300) return "notice"
  if (elapsedMs < 3_550) return "quarter"
  if (elapsedMs < 3_800) return "side"
  if (elapsedMs < 5_700) return "walking"
  return "threshold"
}

function readInvitationMemory() {
  try {
    return window.sessionStorage.getItem(INVITATION_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function rememberInvitation() {
  try {
    window.sessionStorage.setItem(INVITATION_STORAGE_KEY, "1")
  } catch {
    // The visual sequence still works when storage is unavailable.
  }
}

function initAtlasMotion() {
  const body = document.body
  const threshold = document.querySelector("#workshop-threshold")
  const status = document.querySelector("#motion-status")
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
  const replayRequested = new URLSearchParams(window.location.search).has("replay")
  let phase = getInitialInvitationState({
    reducedMotion: reduceMotion.matches,
    seenThisSession: replayRequested ? false : readInvitationMemory(),
  })
  let animationFrame = 0
  let startedAt = 0

  const describe = {
    working: "Pingusama 正在前景整理未完成的連線。",
    notice: "Pingusama 停下手上的工作。",
    quarter: "Pingusama 轉向中央工坊。",
    side: "Pingusama 正走向工坊。",
    walking: "Pingusama 進入工坊，入口仍由你決定是否跟隨。",
    threshold: "Pingusama 已在工坊門檻內等待。",
    closeup: "你來到現在工坊的近景。",
  }

  function render(nextPhase) {
    phase = nextPhase
    body.dataset.phase = nextPhase
    threshold.disabled = nextPhase !== "threshold"
    threshold.setAttribute("aria-hidden", String(nextPhase !== "threshold"))
    status.textContent = describe[nextPhase]

    if (nextPhase === "threshold" || nextPhase === "closeup") {
      rememberInvitation()
    }
  }

  function finishAtThreshold() {
    window.cancelAnimationFrame(animationFrame)
    render("threshold")
  }

  function tick(now) {
    if (!startedAt) startedAt = now
    const nextPhase = phaseForElapsed(now - startedAt)
    if (nextPhase !== phase) render(nextPhase)
    if (nextPhase === "threshold") return
    animationFrame = window.requestAnimationFrame(tick)
  }

  function skipInvitation(event) {
    if (phase === "threshold" || phase === "closeup") return
    if (event.type === "keydown" && event.key === "Tab") return
    finishAtThreshold()
  }

  for (const eventName of ["pointerdown", "wheel", "keydown"]) {
    window.addEventListener(eventName, skipInvitation, {
      capture: true,
      passive: eventName !== "keydown",
    })
  }

  threshold.addEventListener("click", () => {
    if (phase !== "threshold") return
    render("closeup")
  })

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && phase === "closeup") {
      render("threshold")
      threshold.focus({ preventScroll: true })
    }
  })

  reduceMotion.addEventListener("change", (event) => {
    if (event.matches && phase !== "closeup") finishAtThreshold()
  })

  render(phase)
  if (phase === "working") {
    animationFrame = window.requestAnimationFrame(tick)
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAtlasMotion, { once: true })
  } else {
    initAtlasMotion()
  }
}
