import { redirect } from "next/navigation";

export default async function CustomerRedirect({ params }: PageProps<"/customers/[id]">) {
  redirect(`/parties/${(await params).id}`);
}
