// Runs inside Moose's app bundle so macOS permissions belong to Moose, not a helper.
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>
#include <memory>
#include <string>
struct Result {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  std::string value = "default";
  std::string error;
};
struct Work {
  napi_async_work work;
  napi_deferred deferred;
  bool request;
  std::shared_ptr<Result> result = std::make_shared<Result>();
};
static std::string status(UNAuthorizationStatus value) {
  switch (value) {
    case UNAuthorizationStatusDenied: return "denied";
    case UNAuthorizationStatusAuthorized:
    case UNAuthorizationStatusProvisional: return "granted";
    default: return "default";
  }
}
static void execute(napi_env, void *data) {
  auto *work = static_cast<Work *>(data);
  auto result = work->result;
  const bool request = work->request;
  @autoreleasepool {
    @try {
      UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
      [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        if (request && settings.authorizationStatus == UNAuthorizationStatusNotDetermined) {
          [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert completionHandler:^(BOOL granted, NSError *error) {
            if (error) result->error = error.localizedDescription.UTF8String;
            else result->value = granted ? "granted" : "denied";
            dispatch_semaphore_signal(result->done);
          }];
        } else {
          result->value = status(settings.authorizationStatus);
          dispatch_semaphore_signal(result->done);
        }
      }];
      // No Node/Electron main-thread blocking; a late callback owns its result safely.
      if (dispatch_semaphore_wait(result->done, dispatch_time(DISPATCH_TIME_NOW, 180 * NSEC_PER_SEC))) {
        // Do not modify callback-owned memory after a timeout.
        work->result = std::make_shared<Result>();
        work->result->error = "Notification permission request timed out";
      }
    } @catch (NSException *exception) {
      work->result->error = exception.reason.UTF8String;
    }
  }
}
static void complete(napi_env env, napi_status completion, void *data) {
  auto *work = static_cast<Work *>(data);
  napi_value value;
  const std::string error = completion == napi_ok ? work->result->error : "Notification permission check cancelled";
  if (error.empty()) {
    napi_create_string_utf8(env, work->result->value.c_str(), NAPI_AUTO_LENGTH, &value);
    napi_resolve_deferred(env, work->deferred, value);
  } else {
    napi_value message;
    napi_create_string_utf8(env, error.c_str(), NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &value);
    napi_reject_deferred(env, work->deferred, value);
  }
  napi_delete_async_work(env, work->work);
  delete work;
}
static napi_value permission(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value arg, promise, name;
  auto *work = new Work();
  work->request = false;
  napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
  if (count) napi_get_value_bool(env, arg, &work->request);
  napi_create_promise(env, &work->deferred, &promise);
  napi_create_string_utf8(env, "Moose notification permission", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, execute, complete, work, &work->work);
  napi_queue_async_work(env, work->work);
  return promise;
}
static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "permission", NAPI_AUTO_LENGTH, permission, nullptr, &fn);
  napi_set_named_property(env, exports, "permission", fn);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
