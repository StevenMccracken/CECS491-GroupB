//
//  AppDelegate.swift
//  Dropp
//
//  Created by Steven McCracken on 2/20/17.
//  Copyright © 2017 Group B. All rights reserved.
//

import UIKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
  
  var window: UIWindow?
  
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplicationLaunchOptionsKey: Any]?) -> Bool {
    // Override point for customization after application launch.
    let didPresentLogInView = LoginManager.shared.ensureLogin()
    guard !didPresentLogInView else {
      return true
    }
    
    if let user = LoginManager.shared.currentUser {
      UserService.getUser(username: user.username, success: { (fetchedUser: User) in
        LoginManager.shared.updateCurrentUser(with: fetchedUser)
      }, failure: { (getUserError: NSError) in
        debugPrint("Failed to fetch updated user profile for current user after startup", getUserError)
      })
    }
    
    let mainStoryboard = UIStoryboard(name: "Main", bundle: nil)
    guard let initialViewController = mainStoryboard.instantiateInitialViewController() else {
      debugPrint("Initial view controller was nil")
      return false
    }
    
    Utils.present(viewController: initialViewController)
    return true
  }
  
  func applicationWillResignActive(_ application: UIApplication) {
    // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
    // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
  }
  
  func applicationDidEnterBackground(_ application: UIApplication) {
    // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
    // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
  }
  
  func applicationWillEnterForeground(_ application: UIApplication) {
    // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
  }
  
  func applicationDidBecomeActive(_ application: UIApplication) {
    // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
  }
  
  func applicationWillTerminate(_ application: UIApplication) {
    // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
  }
}

extension AppDelegate: UITabBarControllerDelegate {
  
  func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
    guard viewController.restorationIdentifier == Constants.dummyViewControllerRestorationId else {
      return true
    }
    
    let createDroppStoryboard = UIStoryboard(name: "CreateDropp", bundle: nil)
    guard let createDroppViewController = createDroppStoryboard.instantiateInitialViewController() as? CreateDroppViewController else {
      debugPrint("Initial view controller for CreateDropp was invalid")
      return false
    }
    
    if let selectedNavigationController = tabBarController.selectedViewController as? UINavigationController, let feedViewControllerDelegate = selectedNavigationController.childViewControllers.first as? FeedViewControllerDelegate {
      createDroppViewController.feedViewControllerDelegate = feedViewControllerDelegate
    }
    
    let navigationController = UINavigationController(rootViewController: createDroppViewController, customize: true)
    navigationController.navigationBar.prefersLargeTitles = false
    tabBarController.present(navigationController, animated: true, completion: nil)
    return false
  }
}
