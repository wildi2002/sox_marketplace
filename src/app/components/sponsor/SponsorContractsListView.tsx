"use client";

import Button from "../common/Button";
import { useEffect, useRef, useState } from "react";
import SponsorModal from "./SponsorModal";
import { deployOptimisticContract } from "../../lib/blockchain/optimistic";
import ChfNote from "../common/ChfNote";
import { useUser } from "@/app/lib/UserContext";
import { useToast } from "@/app/lib/ToastContext";

type Contract = {
    id: number;
    tip_completion: number;
    timeout_delay: number;
};

export default function SponsorContractsListView() {
    const { user } = useUser();
    const { showToast } = useToast();
    const [modalShown, showModal] = useState(false);
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [selectedContract, setSelectedContract] = useState(-1);
    const [selectedTip, setSelectedTip] = useState<number | undefined>(undefined);
    const [isDeploying, setIsDeploying] = useState(false);
    const deployCancelledRef = useRef(false);

    const fetchContracts = () => {
        fetch("/api/unsponsored-contracts")
            .then((res) => res.json())
            .then((data) => setContracts(data));
    };

    useEffect(() => {
        fetchContracts();

        const handleReloadData = () => {
            fetchContracts();
        };

        window.addEventListener("reloadData", handleReloadData);

        return () => {
            window.removeEventListener("reloadData", handleReloadData);
        };
    }, []);

    const handleSponsorConfirmation = async (pkSponsor: string) => {
        setIsDeploying(true);
        deployCancelledRef.current = false;
        try {
            const contractInfo = await fetch(
                `/api/unsponsored-contracts/${selectedContract}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        pkSponsor,
                    }),
                }
            ).then((res) => res.json());

            if (deployCancelledRef.current) return;

            console.log(contractInfo);
            const deploymentResult = await deployOptimisticContract(
                contractInfo.pk_buyer,
                contractInfo.pk_vendor,
                contractInfo.price as number,
                contractInfo.tip_completion as number,
                contractInfo.tip_dispute as number,
                contractInfo.timeout_delay as number,
                contractInfo.commitment,
                contractInfo.num_blocks as number,
                contractInfo.num_gates as number,
                pkSponsor
            );

            if (deployCancelledRef.current) return;

            const { contractAddress, sessionKeyPrivateKey, sessionKeyAddress } = deploymentResult;

            await fetch(`/api/sponsored-contracts/${selectedContract}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contractAddress,
                    sessionKeyPrivateKey,
                    sessionKeyAddress,
                }),
            });

            if (deployCancelledRef.current) return;

            showToast(`Contract ${selectedContract} sponsored!\nDeployed: ${contractAddress}`, "success", 7000);
        } catch (e: any) {
            console.error("Erreur de déploiement:", e);
            showToast(`Error: ${e?.message || e?.toString()}`, "error");
        } finally {
            setIsDeploying(false);
        }
    };
    const handleCancelDeploy = () => {
        deployCancelledRef.current = true;
        setIsDeploying(false);
    };

    return (
        <div className="bg-gray-300 p-4 rounded w-1/2 overflow-auto">
            <h2 className="text-lg font-semibold mb-4">Contracts</h2>
            <table className="w-full table-fixed border-collapse">
                <thead>
                    <tr className="border-b border-black text-left font-medium">
                        <th className="p-2 w-1/5">ID</th>
                        <th className="p-2 w-1/5">Tip</th>
                        <th className="p-2 w-1/5">Timeout</th>
                        <th className="p-2 w-1/5"></th>
                    </tr>
                </thead>
                <tbody>
                    {contracts.map((c, i) => (
                        <tr
                            key={c.id}
                            className="even:bg-gray-200 border-b border-black h-15"
                        >
                            <td className="p-2 w-1/5">{c.id}</td>
                            <td className="p-2 w-1/5">{c.tip_completion} ETH<ChfNote value={c.tip_completion} /></td>
                            <td className="p-2 w-1/5">{c.timeout_delay}</td>
                            <td className="p-2 w-1/5 text-center">
                                <Button
                                    label="Sponsor"
                                    onClick={() => {
                                        setSelectedContract(c.id);
                                        setSelectedTip(c.tip_completion);
                                        showModal(true);
                                    }}
                                    width="95/100"
                                />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {modalShown && (
                <SponsorModal
                    title="Sponsor Contract"
                    onClose={() => showModal(false)}
                    onConfirm={handleSponsorConfirmation}
                    id_prefix="contract"
                    defaultPk={user?.publicKey ?? ""}
                    tip={selectedTip}
                />
            )}

            {isDeploying && (
                <div className="fixed inset-0 flex items-center justify-center bg-gray-800 bg-opacity-50 z-50">
                    <div className="flex flex-col items-center gap-4">
                        <div className="text-white text-lg">
                            Deploying contract… please wait
                        </div>

                        <div role="status">
                            <svg
                                aria-hidden="true"
                                className="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600"
                                viewBox="0 0 100 101"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <path
                                    d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                                    fill="currentColor"
                                />
                                <path
                                    d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                                    fill="currentFill"
                                />
                            </svg>
                        </div>

                        <Button
                            label="← Cancel"
                            onClick={handleCancelDeploy}
                            width="auto"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
