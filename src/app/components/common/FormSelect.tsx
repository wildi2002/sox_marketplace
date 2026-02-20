"use client";

interface FormSelectProps {
    id: string;
    children: string;
    value: string;
    onChange: (value: string) => void;
    options: string[];
    disabled?: boolean;
}

export default function FormSelect({
    id,
    children,
    value,
    onChange,
    options,
    disabled = false,
}: FormSelectProps) {
    return (
        <div>
            <label className="block mb-1 font-medium" htmlFor={id}>
                {children}
            </label>
            <select
                id={id}
                name={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className={`w-full border border-gray-300 p-2 rounded ${
                    disabled ? "bg-gray-100 text-gray-500" : ""
                }`}
            >
                {options.map((opt) => (
                    <option key={opt} value={opt}>
                        {opt}
                    </option>
                ))}
            </select>
        </div>
    );
}
