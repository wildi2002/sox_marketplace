"use client";

import Button from "../components/common/Button";
import { useRouter } from "next/navigation";
import OngoingContractsListView from "../components/user/OngoingContractsListView";
import { useEffect, useState } from "react";
import NewContractModal from "../components/user/NewContractModal";
import UnsponsoredContractsListView from "../components/user/UnsponsoredContractsListView";
import NonAcceptedPrecontractsListView from "../components/user/NonAcceptedPrecontractsListView";
import { getBalance } from "../lib/blockchain/common";
import FormSelect from "../components/common/FormSelect";
import { ALL_PUBLIC_KEYS } from "../lib/blockchain/config";

export default function Home() {
    const router = useRouter();
    const handleBack = () => {
        router.back();
    };

    const [modalNewContractShown, showModalNewContract] = useState(false);
    const [isLoggedIn, setLoggedIn] = useState(false);
    const [publicKey, setPublicKey] = useState(ALL_PUBLIC_KEYS[0]);
    const [balance, setBalance] = useState("Loading...");

    const logIn = async () => {
        // TODO signature and stuff
        setLoggedIn(true);
        window.dispatchEvent(new Event("reloadData"));
    };

    useEffect(() => {
        const handleReloadData = async () => {
            setBalance(await getBalance(publicKey));
        };

        handleReloadData();
        window.addEventListener("reloadData", handleReloadData);

        return () => {
            window.removeEventListener("reloadData", handleReloadData);
        };
    }, [publicKey]);

    return (
        <main className="p-4 min-h-screen">
            <div className="mb-4">
                <Button label="Retour" onClick={handleBack} width="auto" />
            </div>
            <h1 className="text-xl font-bold mb-4">Sponsored fair exchange</h1>

            <div className="flex gap-8 justify-between items-center mb-8">
                <Button
                    label="To sponsor view"
                    onClick={() => router.push("/")}
                />
                <Button
                    label="Reload data"
                    onClick={() =>
                        window.dispatchEvent(new Event("reloadData"))
                    }
                />
            </div>

            {!isLoggedIn && (
                <>
                    <FormSelect
                        id="user-public-key"
                        value={publicKey}
                        onChange={setPublicKey}
                        options={ALL_PUBLIC_KEYS}
                    >
                        Public key
                    </FormSelect>
                    <br />
                    <Button onClick={logIn} label="Log in" />
                </>
            )}

            {isLoggedIn && (
                <>
                    <div className="flex text-2xl gap-8 justify-between items-center my-8">
                        <p>
                            <b>Balance: </b> {balance} ETH
                        </p>
                        <h1>
                            <b>Public key:</b> {publicKey}
                        </h1>
                    </div>
                    <div className="flex gap-8 justify-between items-center">
                        <Button
                            label="+ New pre-contract"
                            onClick={() => showModalNewContract(true)}
                        />
                        <Button
                            label="Log out"
                            onClick={() => setLoggedIn(false)}
                        />
                    </div>

                    <div className="flex gap-8 my-8">
                        <NonAcceptedPrecontractsListView
                            publicKey={publicKey}
                        />

                        <UnsponsoredContractsListView publicKey={publicKey} />
                    </div>

                    <div className="flex gap-8 my-8">
                        <OngoingContractsListView publicKey={publicKey} />
                        {/* <SponsoredContractsListView publicKey={publicKey} /> */}
                    </div>
                </>
            )}

            {modalNewContractShown && (
                <NewContractModal
                    title="New contract"
                    vendorPk={publicKey}
                    onClose={() => showModalNewContract(false)}
                ></NewContractModal>
            )}
        </main>
    );
}
