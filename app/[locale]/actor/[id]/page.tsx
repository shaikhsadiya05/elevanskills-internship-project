import type { Metadata } from "next";
import ActorProfileView, { getActorMetadata } from "../../../../src/components/actors/ActorProfileView";

export const revalidate = 3600;

export function generateStaticParams() {
  return [];
}

type LocalizedActorPageProps = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: LocalizedActorPageProps): Promise<Metadata> {
  const { locale, id } = await params;
  return getActorMetadata(id, locale);
}

export default async function LocalizedActorPage({ params }: LocalizedActorPageProps) {
  const { locale, id } = await params;
  return <ActorProfileView actorId={id} locale={locale} />;
}