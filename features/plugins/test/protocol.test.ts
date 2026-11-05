import { describe, expect, it } from "vitest"
import { snakeCase } from "../src/protocol.ts"

describe(snakeCase, () => {
  it("matches the SDK's names for hooks and methods", () => {
    expect(snakeCase("onRouteChanged")).toBe("on_route_changed")
    expect(snakeCase("macroRendererSlotted")).toBe("macro_renderer_slotted")
    expect(snakeCase("SlashCommandHookeditor/hook3")).toBe("slash_command_hookeditor_hook3")
    expect(snakeCase("register-plugin-slash-command")).toBe("register_plugin_slash_command")
    expect(snakeCase("setSDKMetadata")).toBe("set_sdk_metadata")
    expect(snakeCase("ui_showMsg")).toBe("ui_show_msg")
  })
})
