//
//  Platform.swift
//  Dropp
//
//  Created by Steven McCracken on 1/18/18.
//  Copyright © 2018 Group B. All rights reserved.
//

import Foundation

struct Platform {
  static let isSimulator: Bool = {
    var isSim = false
    #if arch(i386) || arch(x86_64)
      isSim = true
    #endif
    return isSim
  }()
}
