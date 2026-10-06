Pod::Spec.new do |s|
  s.name           = 'SeqnoVault'
  s.version        = '1.0.0'
  s.summary        = 'Coordinated iCloud Drive file layer'
  s.description    = 'Coordinated iCloud Drive file layer for seqno'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
