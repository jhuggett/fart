#+build !darwin
package main

// Other platforms open documents through argv (or a drop); nothing to hook.

app_hook_init :: proc() {}
