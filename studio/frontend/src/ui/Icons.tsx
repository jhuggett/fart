// Small line icons, drawn with the current colour. One path each.

import type { JSX } from "preact";

function icon(d: string, extra?: JSX.Element) {
	return (props: { size?: number }) => (
		<svg width={props.size ?? 14} height={props.size ?? 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d={d} />
			{extra}
		</svg>
	);
}

export const I = {
	select: icon("M4 2l9 6.5-4.2 1.1L6.5 14z"),
	rect: icon("M3 3h10v10H3z"),
	circle: icon("M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"),
	line: icon("M3 13L13 3"),
	poly: icon("M8 2l6 4.5-2.3 7H4.3L2 6.5z"),
	collision: icon("M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4z"),
	eye: icon("M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z", <circle cx="8" cy="8" r="2" />),
	eyeOff: icon("M2 2l12 12M6.2 6.3A2.5 2.5 0 0 0 9.8 9.8M1.5 8s2.5-4.5 6.5-4.5c.9 0 1.7.2 2.5.5M14.5 8S12 12.5 8 12.5c-.9 0-1.7-.2-2.5-.5"),
	lock: icon("M4 7V5a4 4 0 0 1 8 0v2M3 7h10v7H3z"),
	unlock: icon("M4 7V5a4 4 0 0 1 7.6-1.6M3 7h10v7H3z"),
	grid: icon("M2 6h12M2 10h12M6 2v12M10 2v12"),
	play: icon("M4 3l9 5-9 5z"),
	pause: icon("M4 3h3v10H4zM9 3h3v10H9z"),
	plus: icon("M8 3v10M3 8h10"),
	target: icon("M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3", <circle cx="8" cy="8" r="3" />),
	anchor: icon("M8 3v11M4.5 10.5L8 14l3.5-3.5M5 5.5h6"),
	menu: icon("M2 4h12M2 8h12M2 12h12"),
	chevron: icon("M6 3l5 5-5 5"),
	close: icon("M4 4l8 8M12 4l-8 8"),
	up: icon("M3 10l5-5 5 5"),
	down: icon("M3 6l5 5 5-5"),
};
