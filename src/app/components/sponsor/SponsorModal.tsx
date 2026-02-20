import { useState } from "react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import FormSelect from "../common/FormSelect";
import { ALL_PUBLIC_KEYS } from "@/app/lib/blockchain/config";

interface SponsorModalProps {
    title: string;
    onClose: () => void;
    onConfirm: (pk: string) => void;
    id_prefix: string;
}

export default function SponsorModal({
    title,
    onClose,
    onConfirm,
    id_prefix,
}: SponsorModalProps) {
    const [pkSponsor, setPkSponsor] = useState(ALL_PUBLIC_KEYS[0]);

    const onClick = () => {
        onConfirm(pkSponsor);
        window.dispatchEvent(new Event("reloadData"));
        onClose();
    };

    return (
        <Modal onClose={onClose} title={title}>
            <div className="">
                <div className="block">
                    <FormSelect
                        id={`${id_prefix}-sponsor-pk`}
                        value={pkSponsor}
                        onChange={setPkSponsor}
                        options={ALL_PUBLIC_KEYS}
                    >
                        Public key
                    </FormSelect>
                </div>
                <div className="flex text-center gap-8 mt-8">
                    <Button label="Confirm" onClick={onClick} />
                    <Button label="Cancel" onClick={onClose} />
                </div>
            </div>
        </Modal>
    );
}
