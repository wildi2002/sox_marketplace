interface FormTextFieldProps {
    id: string;
    children: string;
    type: string;
    value: string;
    onChange: (newValue: string) => void;
}

export default function FormTextField({
    id,
    children: label,
    type,
    value,
    onChange,
}: FormTextFieldProps) {
    return (
        <div>
            <label className="block mb-1 font-medium" htmlFor={id}>
                {label}
            </label>
            <input
                name={id}
                id={id}
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded"
            />
        </div>
    );
}
