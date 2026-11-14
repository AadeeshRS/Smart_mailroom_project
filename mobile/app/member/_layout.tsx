import { RoleTabs } from '../../src/navigation';

export default function Layout() {
  return <RoleTabs role="MEMBER" tabs={[{ name: 'profile', title: 'Profile', icon: 'person-outline' }]} />;
}
