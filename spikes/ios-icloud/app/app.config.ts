import type { ExpoConfig } from 'expo/config';
import { type ConfigPlugin, withAppDelegate, withInfoPlist } from 'expo/config-plugins';

const container = 'iCloud.com.seqno.spike.vault';

const iCloud = {
  entitlements: {
    'com.apple.developer.icloud-container-identifiers': [container],
    'com.apple.developer.ubiquity-container-identifiers': [container],
    'com.apple.developer.icloud-services': ['CloudDocuments'],
  },
  infoPlist: {
    NSUbiquitousContainers: {
      [container]: {
        NSUbiquitousContainerIsDocumentScopePublic: true,
        NSUbiquitousContainerName: 'seqno',
        NSUbiquitousContainerSupportedFolderLevels: 'Any',
      },
    },
  },
};

// The iOS 27 SDK traps at launch unless the app adopts the UIScene life cycle. The SDK 57 template
// predates that; this ports the SDK 58 template's change onto expo's built-in ExpoAppSceneDelegate.
const withSceneLifecycle: ConfigPlugin = (config) => {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return c;
  });
  return withAppDelegate(config, (c) => {
    c.modResults.contents = c.modResults.contents
      .replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
      .replace(/#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow[\s\S]*?#endif\n/, '');
    return c;
  });
};

export default (): ExpoConfig =>
  withSceneLifecycle({
    name: 'SeqnoVaultSpike',
    slug: 'seqno-vault-spike',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      bundleIdentifier: 'com.seqno.spike.vault',
      supportsTablet: true,
      ...(process.env.SEQNO_ICLOUD === '1' ? iCloud : {}),
    },
  });
