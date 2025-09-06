-- MAME SNES CPU trace autoboot script
-- Environment variables:
--   TRACE_OUT:     output trace filename (default: trace_snes.log)
--   TRACE_FRAMES:  number of frames to trace before exit (default: 1800)

local out   = os.getenv("TRACE_OUT") or "trace_snes.log"
local limit = tonumber(os.getenv("TRACE_FRAMES") or "1800") or 1800
local frames = 0

emu.add_machine_reset_notifier(function(_)
  -- Begin tracing the main SNES CPU on machine reset
  if manager and manager.machine and manager.machine.debugger then
    print("[MAME-LUA] starting trace to " .. out)
    manager.machine.debugger:command("focus :maincpu")
    manager.machine.debugger:command(string.format("trace %s", out))
  end
end)

emu.add_machine_frame_notifier(function(_)
  frames = frames + 1
  if frames >= limit then
    if manager and manager.machine and manager.machine.debugger then
      manager.machine.debugger:command("notrace")
    end
    emu.exit()
  end
end)

