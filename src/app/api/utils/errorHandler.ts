import { NextResponse } from "next/server";

/**
 * Wrapper pour les route handlers qui garantit qu'une erreur JSON est toujours retournée
 * même si une erreur se produit lors de l'import du module ou ailleurs.
 */
export function withErrorHandler(
    handler: (req: Request) => Promise<Response>
): (req: Request) => Promise<Response> {
    return async (req: Request) => {
        try {
            return await handler(req);
        } catch (error: any) {
            console.error("❌ Erreur non capturée dans le route handler:", error);
            console.error("   Message:", error?.message);
            console.error("   Stack:", error?.stack);
            
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isDev = process.env.NODE_ENV === "development";
            
            const responseBody: any = {
                error: errorMessage || "Erreur serveur inattendue"
            };
            
            if (isDev) {
                responseBody.details = {
                    message: errorMessage,
                    stack: error?.stack,
                    name: error?.name,
                    code: error?.code
                };
            }
            
            return NextResponse.json(
                responseBody,
                {
                    status: 500,
                    headers: {
                        "Content-Type": "application/json; charset=utf-8"
                    }
                }
            );
        }
    };
}





