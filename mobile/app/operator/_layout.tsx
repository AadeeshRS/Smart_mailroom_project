import { RoleTabs } from '../../src/navigation';

export default function Layout() {
  return <RoleTabs role="OPERATOR" tabs={[{ name: 'profile', title: 'Profile', icon: 'person-outline' }]} />;
}
