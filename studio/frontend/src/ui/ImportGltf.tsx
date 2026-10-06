// Import glTF…: the sheet between choosing a model and having it in the
// project. It shows what the import would make as the options change
// (nothing is written until Import), asks before replacing a file, then
// opens the model. A .glb or .gltf dropped on the window lands here too.

import { useMemo, useState } from "preact/hooks";
import { closeSheet, confirm, openSheet, sheetOpen } from "../state/prompt.ts";
import { inWorkspace, project } from "../state/project.ts";
import { DEFAULT_CHOICES, defaultName, isGltfName, nameProblem, pickSource, runImport, sourceFromFiles, targetFor, writeImport, type GltfSource, type ImportChoices } from "../state/importGltf.ts";
import { Checkbox, NumberField, SegmentedControl, Sheet, TextField } from "./ur.tsx";
import "../styles/import.css";

const count = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const SIZES = [
	{ value: "scale" as const, label: "Scale", title: "Units in the file for each unit of the model" },
	{ value: "height" as const, label: "Height", title: "Scale the model to stand this many units tall" },
];

function ImportGltf({ src, name: name0, choices: choices0 }: { src: GltfSource; name: string; choices: ImportChoices }) {
	const [name, setName] = useState(name0);
	const [c, setC] = useState(choices0);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState("");
	const set = (patch: Partial<ImportChoices>) => (setC({ ...c, ...patch }), setErr(""));
	// the import runs as the options change: what the sheet shows is what Import writes
	const { result, error } = useMemo(() => runImport(src, c), [src, c]);
	const n = name.trim();
	const bad = n === "" ? null : nameProblem(n);
	const rel = n && !bad ? targetFor(n) : "";
	const exists = !!rel && project.files.value.includes(rel);
	const go = async () => {
		if (!result || !rel) return;
		closeSheet();
		if (exists && !(await confirm(`Replace ${rel}?`, { body: "A file of that name is in the project. Importing writes over it; its checkpoint stays.", ok: "Replace", danger: true }))) {
			// back to the sheet as it was
			return openSheet(() => <ImportGltf src={src} name={name} choices={c} />);
		}
		try {
			await writeImport(rel, result, src.name);
		} catch (e) {
			project.error.value = `could not write ${rel}: ${String(e).replace(/^Error: /, "")}`;
		}
	};
	const s = result?.summary;
	return (
		<Sheet
			title="Import glTF"
			message={rel ? `${src.name} lands at ${rel}${exists ? ", which exists: importing asks before replacing it." : "."}` : src.name}
			width={480}
			onClose={closeSheet}
			footnote={err || undefined}
			actions={[
				{ label: "Cancel", onClick: closeSheet },
				{ label: "Import", primary: true, disabled: busy || !result || !n || !!bad, onClick: () => (setBusy(true), void go()) },
			]}
		>
			<TextField label="Name" mono value={name} autoFocus invalid={!!bad} hint={bad ?? undefined} onChange={setName} />
			<div class="ur-tf-wrap">
				<span class="ur-tf-label">Size</span>
				<div class="import-row">
					<SegmentedControl
						options={SIZES}
						value={c.size}
						label="Size"
						onChange={(size) => {
							// switching to a height starts from the height the model has now
							if (size === "height" && c.size !== "height" && s && s.size[1] > 0) set({ size, height: +s.size[1].toFixed(3) });
							else set({ size });
						}}
					/>
					{c.size === "scale" ? (
						<NumberField key="scale" label="Scale" value={c.scale} min={0.001} step={1} suffix="×" stepper={false} onChange={(scale) => set({ scale })} />
					) : (
						<NumberField key="height" label="Height" value={c.height} min={0.001} step={1} suffix="units" stepper={false} onChange={(height) => set({ height })} />
					)}
				</div>
			</div>
			<div class="import-checks">
				<Checkbox checked={c.quads} onChange={(quads) => set({ quads })} label="Pair triangles into quads" title="glTF holds only triangles; two in one plane that share an edge become the quad they were" />
				<Checkbox checked={c.shades} onChange={(shades) => set({ shades })} label="Vertex colours as shades" title="The brightness painted on each vertex becomes the shape's shades" />
				<Checkbox checked={c.merge} onChange={(merge) => set({ merge })} label="Merge into one part" title="Everything in one part named main; animations are left out" />
				<Checkbox checked={c.splitMaterials} onChange={(splitMaterials) => set({ splitMaterials })} label="A shape per material" title="Instead of one shape painted with several colours, for readers older than format 1.8" />
			</div>
			{s && result ? (
				<div class="import-summary" data-import-summary>
					<span class="counts">
						{[count(s.parts, "part"), count(s.shapes, "shape"), count(s.points, "point"), `${count(s.faces, "face")}${s.quads ? ` (${count(s.quads, "quad")})` : ""}`, count(s.tokens, "colour"), count(s.clips, "clip")].join(" · ")}
					</span>
					<span class="size">
						{s.size.map((v) => +v.toFixed(2)).join(" × ")} units{c.size === "height" ? `, at ${+s.scale.toFixed(4)}×` : ""}
					</span>
					{result.warnings.length > 0 && (
						<>
							<span class="import-warnings-title">{count(result.warnings.length, "warning")}</span>
							<ul class="import-warnings">
								{result.warnings.map((w) => (
									<li key={w}>{w}</li>
								))}
							</ul>
						</>
					)}
				</div>
			) : (
				<div class="import-summary failed" data-import-summary>
					{error}
				</div>
			)}
		</Sheet>
	);
}

/** Open the sheet on a model in hand. */
export function importSheet(src: GltfSource) {
	openSheet(() => <ImportGltf src={src} name={defaultName(src)} choices={DEFAULT_CHOICES} />);
}

/** File › Import glTF…: choose a model, then the sheet. */
export async function importGltfCommand() {
	try {
		const src = await pickSource();
		if (src) importSheet(src);
	} catch (e) {
		project.error.value = `could not read the model: ${String(e).replace(/^Error: /, "")}`;
	}
}

// A model dropped on the window: the same sheet. Only with a project open and no sheet up;
// anything else dropped is left to the page.
if (typeof window !== "undefined") {
	const carries = (e: DragEvent) => inWorkspace() && !sheetOpen() && [...(e.dataTransfer?.types ?? [])].includes("Files");
	window.addEventListener("dragover", (e) => {
		if (carries(e)) e.preventDefault();
	});
	window.addEventListener("drop", (e) => {
		if (!carries(e)) return;
		const files = [...(e.dataTransfer?.files ?? [])];
		if (!files.some((f) => isGltfName(f.name))) return;
		e.preventDefault();
		void sourceFromFiles(files).then((src) => src && importSheet(src));
	});
}
