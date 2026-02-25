import Modal from "../common/Modal";
import Button from "../common/Button";

interface SponsorModalProps {
    title: string;
    onClose: () => void;
    onConfirm: (pk: string) => void;
    id_prefix: string;
    defaultPk: string;
    tip?: number;
}

export default function SponsorModal({
    title,
    onClose,
    onConfirm,
    defaultPk,
    tip,
}: SponsorModalProps) {
    const onClick = () => {
        onConfirm(defaultPk);
        window.dispatchEvent(new Event("reloadData"));
        onClose();
    };

    return (
        <Modal onClose={onClose} title={title}>
            <div>
                <p className="text-sm text-gray-500 mb-1">Sponsor account:</p>
                <p className="font-mono text-sm bg-gray-100 rounded px-3 py-2 break-all mb-4">
                    {defaultPk}
                </p>
                {tip !== undefined && (
                    <p className="text-sm text-gray-700 mb-6">
                        Tip: <span className="font-semibold">{tip} ETH</span>
                    </p>
                )}
                <div className="flex text-center gap-8">
                    <Button label="Confirm" onClick={onClick} />
                    <Button label="Cancel" onClick={onClose} />
                </div>
            </div>
        </Modal>
    );
}
