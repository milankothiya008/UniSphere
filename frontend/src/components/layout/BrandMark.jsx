import { useId } from "react";

/**
 * The CampusConnect mark: a "C" that is also a chat bubble, with two dots inside and a gold dot leaving
 * through the opening — campus life, connected. Same drawing as public/favicon.svg and the app icons.
 */
export const BrandMark = ({ size = 32, className = "" }) => {
    const id = useId().replace(/:/g, "");
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
            <defs>
                <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#2c46b0" />
                    <stop offset=".55" stopColor="#4b3fd0" />
                    <stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
                <radialGradient id={`s${id}`} cx=".25" cy=".15" r=".9">
                    <stop offset="0" stopColor="#fff" stopOpacity=".22" />
                    <stop offset=".6" stopColor="#fff" stopOpacity="0" />
                </radialGradient>
            </defs>
            <rect width="512" height="512" rx="118" fill={`url(#g${id})`} />
            <rect width="512" height="512" rx="118" fill={`url(#s${id})`} />
            <path d="M352 172a134 134 0 1 0 0 168" fill="none" stroke="#fff" strokeWidth="58" strokeLinecap="round" />
            <path d="M160 334l-44 66 84-30z" fill="#fff" stroke="#fff" strokeWidth="10" strokeLinejoin="round" />
            <circle cx="212" cy="256" r="25" fill="#fff" />
            <circle cx="292" cy="256" r="25" fill="#fff" />
            <circle cx="380" cy="256" r="31" fill="#f5b83d" />
        </svg>
    );
};
