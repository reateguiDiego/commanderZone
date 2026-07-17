import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ContextSubmenuComponent } from './context-submenu.component';

describe('ContextSubmenuComponent viewport collision', () => {
	let fixture: ComponentFixture<ContextSubmenuComponent>;
	let component: ContextSubmenuComponent;

	beforeEach(async () => {
		await TestBed.configureTestingModule({ imports: [ContextSubmenuComponent] }).compileComponents();
		fixture = TestBed.createComponent(ContextSubmenuComponent);
		component = fixture.componentInstance;
		fixture.componentRef.setInput('label', 'View');
		fixture.componentRef.setInput('items', [
			{ value: 'all', label: 'View all' },
			{ value: 'top', label: 'View top cards' },
		]);
		fixture.componentRef.setInput('expanded', true);
		fixture.detectChanges();
	});

	afterEach(() => vi.restoreAllMocks());

	it('flips the View panel left and up when its preferred placement exceeds the viewport', () => {
		const trigger = fixture.nativeElement.querySelector('.submenu-trigger') as HTMLElement;
		vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
			x: 770, y: 570, left: 770, top: 570, right: 840, bottom: 598, width: 70, height: 28, toJSON: () => ({}),
		});
		vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(850);
		vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
		component.toggle({ preventDefault: () => undefined, stopPropagation: () => undefined, currentTarget: trigger } as unknown as MouseEvent);
		fixture.detectChanges();

		expect(component.resolvedSide()).toBe('left');
		expect(component.resolvedDirection()).toBe('up');
		expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.side-left.direction-up')).not.toBeNull();
	});

	it('keeps the panel right and down when both fit', () => {
		const trigger = fixture.nativeElement.querySelector('.submenu-trigger') as HTMLElement;
		vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
			x: 100, y: 100, left: 100, top: 100, right: 180, bottom: 130, width: 80, height: 30, toJSON: () => ({}),
		});
		vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
		vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
		component.toggle({ preventDefault: () => undefined, stopPropagation: () => undefined, currentTarget: trigger } as unknown as MouseEvent);

		expect(component.resolvedSide()).toBe('right');
		expect(component.resolvedDirection()).toBe('down');
	});
});
