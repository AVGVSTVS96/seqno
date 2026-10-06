import type { ExpoConfig } from "expo/config"
import { type ConfigPlugin, withAppDelegate, withInfoPlist } from "expo/config-plugins"

// The iOS 27 SDK traps at launch unless the app adopts the UIScene life cycle, which the SDK 57
// template predates. This moves window creation into expo's built-in ExpoAppSceneDelegate.
const withSceneLifecycle: ConfigPlugin = (config) =>
  withAppDelegate(
    withInfoPlist(config, (c) => {
      c.modResults.UIApplicationSceneManifest = {
        UIApplicationSupportsMultipleScenes: false,
        UISceneConfigurations: {
          UIWindowSceneSessionRoleApplication: [
            { UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "EXExpoAppSceneDelegate" },
          ],
        },
      }
      return c
    }),
    (c) => {
      c.modResults.contents = c.modResults.contents
        .replace("class AppDelegate: ExpoAppDelegate {", "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {")
        .replace(/#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow[\s\S]*?#endif\n/, "")
      return c
    },
  )

export default (): ExpoConfig =>
  withSceneLifecycle({
    name: "iosloro",
    slug: "ios-loro",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    ios: { bundleIdentifier: "dev.seqno.iosloro", supportsTablet: false },
  })
