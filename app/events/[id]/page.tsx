import CampusApp from '@/components/campus-app';

export default async function EventPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <CampusApp initialEventId={id}/>;
}
