Pod::Spec.new do |s|
  s.name           = 'LeksCrypto'
  s.version        = '0.1.0'
  s.summary        = 'LEKS end-to-end encryption core'
  s.description    = 'Bridges the Rust encryption core (OpenMLS) into the app.'
  s.author         = 'LEKS'
  s.homepage       = 'https://github.com/personalwework1-oss/LEKS'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "*.{h,swift}"
  s.public_header_files = "LeksCryptoFFI.h"
  # Built from crates/leks-crypto by scripts/build-native.sh
  s.vendored_frameworks = "LeksCrypto.xcframework"
end
