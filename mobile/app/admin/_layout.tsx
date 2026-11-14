import { RoleTabs } from '../../src/navigation';

export default function Layout() {
  return <RoleTabs role="ADMIN" tabs={[{ name: 'profile', title: 'Profile', icon: 'person-outline' }]} />;
}
