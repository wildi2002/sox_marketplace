import { MouseEventHandler } from "react";

type ButtonProps = {
    label: string;
    onClick: MouseEventHandler<HTMLButtonElement>;
    width?: string;
    isDisabled?: boolean;
};

export default function Button({
    label,
    onClick,
    width,
    isDisabled,
}: ButtonProps) {
    const all_classes =
        " bg-blue-200 hover:bg-blue-300 text-black py-2 px-4 rounded-md transition-colors disabled:bg-gray-400 disabled:opacity-50";
    let width_class = width ? `w-${width}` : "w-full";
    if (isDisabled == undefined) {
        isDisabled = false;
    }
    return (
        <button
            onClick={onClick}
            className={width_class + all_classes}
            disabled={isDisabled}
        >
            {label}
        </button>
    );
}
