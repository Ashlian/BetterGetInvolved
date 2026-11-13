import CampusApp from '@/components/campus-app';

export default async function ForumPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <CampusApp initialView="forums" initialForumPostId={id}/>;
}
