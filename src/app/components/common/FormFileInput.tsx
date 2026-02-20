import React, { useRef } from "react";

interface FormFileInputProps {
    id: string;
    children: string;
    onChange?: (newValue: FileList | null) => void;
    hidden?: boolean;
}

export default function FormFileInput({
    id,
    children: label,
    onChange = () => {},
    hidden,
}: FormFileInputProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
        <div>
            <label className="block mb-1 font-medium" htmlFor={id}>
                {label}
            </label>
            <input
                ref={fileInputRef}
                name={id}
                id={id}
                type="file"
                onChange={(e) => onChange(e.target.files)}
                className={`w-full border border-gray-300 p-2 rounded ${
                    hidden ? "hidden" : ""
                }`}
            />
        </div>
    );
}
