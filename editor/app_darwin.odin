#+build darwin
package main

// macOS app plumbing: the Finder opens documents by Apple event, not argv.
// GLFW's application delegate does not listen for it, so we teach its
// class application:openFiles: before the window exists (the launch-time
// event is delivered during launch, before ed_init could hook a live
// delegate). Paths land in g_open_queue; the editor drains it each frame.

import "base:intrinsics"
import "base:runtime"
import "core:strings"

@(objc_class = "NSObject")
NS_Object :: struct {
	using _: intrinsics.objc_object,
}
@(objc_class = "NSApplication")
NS_Application :: struct {
	using _: NS_Object,
}
@(objc_class = "NSArray")
NS_Array :: struct {
	using _: NS_Object,
}
@(objc_class = "NSString")
NS_String :: struct {
	using _: NS_Object,
}

foreign import objc_rt "system:objc"
@(default_calling_convention = "c")
foreign objc_rt {
	objc_lookUpClass :: proc(name: cstring) -> ^intrinsics.objc_class ---
	class_replaceMethod :: proc(cls: ^intrinsics.objc_class, name: ^intrinsics.objc_selector, imp: rawptr, types: cstring) -> rawptr ---
}

@(private = "file")
open_files_imp :: proc "c" (self: ^intrinsics.objc_object, _: ^intrinsics.objc_selector, app: ^NS_Application, files: ^NS_Array) {
	context = runtime.default_context()
	n := intrinsics.objc_send(uint, files, "count")
	for i in 0 ..< n {
		s := intrinsics.objc_send(^NS_String, files, "objectAtIndex:", i)
		cs := intrinsics.objc_send(cstring, s, "UTF8String")
		if cs != nil do append(&g_open_queue, strings.clone(string(cs)))
	}
	intrinsics.objc_send(nil, app, "replyToOpenOrPrint:", uint(0)) // NSApplicationDelegateReplySuccess
}

app_hook_init :: proc() {
	cls := objc_lookUpClass("GLFWApplicationDelegate")
	if cls == nil do return
	sel := intrinsics.objc_register_selector("application:openFiles:")
	class_replaceMethod(cls, sel, rawptr(open_files_imp), "v@:@@")
}
