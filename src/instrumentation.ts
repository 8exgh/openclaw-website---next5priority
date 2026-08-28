/* Next.js calls register() once when the server starts (not at build).
   Node runtime only: the background timers need sqlite and sockets. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./lib/scheduler.ts");
  startScheduler();
}
