package raylib_spin

// The fifty lines for 3D: load a 3D .fart, flatten each part into a
// raylib mesh with the light baked into its vertex colours, and draw the
// parts through their world maps every frame while a clip plays. Run
// from the repo root: odin run loaders/odin/examples/raylib_spin
//
// Space plays the next clip; drag turns the camera.

import "core:fmt"
import "core:math/linalg"
import "core:os"
import rl "vendor:raylib"
import fart "../.."

FILE :: #directory + "/../../../../examples/pistol/flintlock.fart"
LIGHT :: fart.V3{-1, -2, -3} // toward the light, rest space of the whole model
AMBIENT :: f32(0.4)

Part_Draw :: struct {
	part:   ^fart.Part3,
	meshes: [dynamic]rl.Mesh,
}

main :: proc() {
	data, err := os.read_entire_file(FILE, context.allocator)
	if err != nil {
		fmt.eprintln("cannot read", FILE, err)
		return
	}
	doc, dok := fart.load_bytes_3d(data)
	if !dok {
		fmt.eprintln("not a 3D .fart")
		return
	}
	rl.InitWindow(900, 600, "fastart: flintlock.fart")
	defer rl.CloseWindow()
	rl.SetTargetFPS(60)

	// every part's shapes as raylib meshes, once; the light is baked into
	// the colours (a real game lights in a shader and keeps the normals)
	light := linalg.normalize(LIGHT)
	draws := make([dynamic]Part_Draw)
	for &p in doc.parts {
		tms := make([dynamic]fart.Tri_Mesh)
		fart.flatten_part(&doc, &p, &tms)
		pd := Part_Draw{part = &p}
		for &tm in tms {
			n := len(tm.positions)
			m: rl.Mesh
			m.vertexCount = i32(n)
			m.triangleCount = i32(n / 3)
			verts := make([]f32, n * 3)
			norms := make([]f32, n * 3)
			cols := make([]u8, n * 4)
			base := fart.color_of_3d(&doc, tm.color)
			for i in 0 ..< n {
				q := fart.to_y_up(tm.positions[i])
				nn := fart.to_y_up(tm.normals[i])
				verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2] = q.x, q.y, q.z
				norms[i * 3], norms[i * 3 + 1], norms[i * 3 + 2] = nn.x, nn.y, nn.z
				lit := max(0, linalg.dot(tm.normals[i], light))
				shade := (tm.shade == 0 ? 1 : tm.shade) * (AMBIENT + (1 - AMBIENT) * lit)
				c := fart.shade_color(base, shade)
				cols[i * 4], cols[i * 4 + 1], cols[i * 4 + 2], cols[i * 4 + 3] = c[0], c[1], c[2], c[3]
			}
			m.vertices = raw_data(verts)
			m.normals = raw_data(norms)
			m.colors = raw_data(cols)
			rl.UploadMesh(&m, false)
			append(&pd.meshes, m)
		}
		append(&draws, pd)
	}
	material := rl.LoadMaterialDefault()

	camera := rl.Camera3D{position = {30, 18, 40}, target = {0, -2, 0}, up = {0, 1, 0}, fovy = 40, projection = .PERSPECTIVE}
	clip_i := 0
	t: f32
	frame := make([dynamic]fart.State_Part3)
	for !rl.WindowShouldClose() {
		dt := rl.GetFrameTime()
		if rl.IsKeyPressed(.SPACE) && len(doc.clips) > 0 {
			clip_i = (clip_i + 1) % len(doc.clips)
			t = 0
		}
		rl.UpdateCamera(&camera, .THIRD_PERSON)
		// the pose: the clip's frame at t, or the first state
		if len(doc.clips) > 0 {
			c := &doc.clips[clip_i]
			t += dt
			if !c.loop && t > fart.clip_duration_3d(c) + 0.5 do t = 0
			fart.sample_clip_3d(&doc, c, t, &frame)
		} else if len(doc.states) > 0 {
			clear(&frame)
			append(&frame, ..doc.states[0].parts[:])
		}
		rl.BeginDrawing()
		rl.ClearBackground({30, 30, 34, 255})
		rl.BeginMode3D(camera)
		rl.DrawGrid(20, 2)
		for sp in frame {
			for &pd in draws {
				if pd.part.name != sp.part do continue
				W := fart.Y_UP * fart.world_xf_3d(&doc, frame[:], pd.part.name) // the pose, in engine space
				for m in pd.meshes do rl.DrawMesh(m, material, rl.Matrix(W))
			}
		}
		rl.EndMode3D()
		name := len(doc.clips) > 0 ? doc.clips[clip_i].name : "rest"
		rl.DrawText(rl.TextFormat("%s  ·  space: next clip  ·  drag: orbit", name), 12, 12, 18, rl.LIGHTGRAY)
		rl.EndDrawing()
	}
}
