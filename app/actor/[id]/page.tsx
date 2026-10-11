import type { Metadata } from "next";
import ActorProfileView, { getActorMetadata } from "../../../src/components/actors/ActorProfileView";

type ActorPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata(props: ActorPageProps): Promise<Metadata> {
  const { id } = await props.params;
  return getActorMetadata(id, "en-US");
}

export default async function ActorPage({ params }: ActorPageProps) {
  const { id } = await params;
  return <ActorProfileView actorId={id} locale="en-US" />;
}
