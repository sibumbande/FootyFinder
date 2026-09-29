import { Navigate, useParams } from 'react-router-dom';

/** Gate 7 / N3: the old manual-venue team fixture page now opens the shared create-match wizard. */
export function RetiredTeamFixtureRedirect() {
  const { teamId = '' } = useParams();
  return <Navigate replace to={`/matches/new?playAs=team:${teamId}&lock=1`} />;
}
