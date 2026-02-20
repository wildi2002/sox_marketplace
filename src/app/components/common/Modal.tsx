import { ReactNode, useEffect } from "react";

export type ModalProps = {
    onClose: () => void;
    title: string;
    children: ReactNode;
};

export default function Modal({ onClose, title, children }: ModalProps) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        const handleBackgroundClick = (e: MouseEvent) => {
            if ((e.target as HTMLElement).classList.contains("fixed")) {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        document.addEventListener("click", handleBackgroundClick);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("click", handleBackgroundClick);
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 bg-gray-500/75 flex items-center justify-center z-50">
            <div className="bg-[#f5f5f5] p-6 rounded shadow-lg w-2/3 max-w-full max-h-[90vh] overflow-y-auto pt-0">
                <div className="flex justify-between items-center mb-4 sticky top-0 bg-[#f5f5f5] z-10 pt-5">
                    <h3 className="text-xl font-bold">{title}</h3>
                    <button
                        onClick={onClose}
                        className="text-sm text-blue-800 hover:underline"
                    >
                        Close
                    </button>
                </div>
                <div className="modal-content space-y-4">{children}</div>
            </div>
        </div>
    );
}
