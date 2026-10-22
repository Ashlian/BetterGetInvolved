import CampusApp from '@/components/campus-app';

export default async function ClubPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <CampusApp initialClubId={id}/>;
}
