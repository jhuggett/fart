// The sheets of state/prompt.ts, drawn: the one-field ask, the buttons of
// confirm and choose, and whichever custom sheet is open.

import { prompt, promptCommit, promptCancel, confirmBox, confirmAnswer, sheet } from "../state/prompt.ts";
import { Sheet, TextField } from "./ur.tsx";

export function Confirm() {
	if (!confirmBox.open.value) return null;
	return (
		<Sheet
			title={confirmBox.title.value}
			message={confirmBox.body.value || undefined}
			onClose={() => confirmAnswer("cancel")}
			actions={confirmBox.choices.value.map((c) => ({ label: c.label, primary: c.primary, danger: c.danger, onClick: () => confirmAnswer(c.id) }))}
		/>
	);
}

export function Prompt() {
	if (!prompt.open.value) return null;
	const o = prompt.opts.value;
	const v = prompt.value.value;
	const bad = v.trim() ? (o.validate?.(v.trim()) ?? null) : null;
	return (
		<Sheet
			title={prompt.title.value}
			message={o.message}
			onClose={promptCancel}
			actions={[
				{ label: "Cancel", onClick: promptCancel },
				{ label: o.ok ?? "Continue", primary: true, disabled: !v.trim() || !!bad, onClick: promptCommit },
			]}
		>
			<TextField value={v} autoFocus mono={o.mono} invalid={!!bad} hint={bad ?? o.hint} onChange={(t) => (prompt.value.value = t)} />
		</Sheet>
	);
}

export function Sheets() {
	const s = sheet.value;
	return s ? <>{s()}</> : null;
}
