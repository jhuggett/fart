import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import wails from "@wailsio/runtime/plugins/vite";

export default defineConfig({
	server: {
		host: "127.0.0.1",
		port: Number(process.env.WAILS_VITE_PORT) || 9245,
		strictPort: true,
	},
	plugins: [preact(), wails("./bindings")],
	build: {
		target: "es2022",
	},
});
