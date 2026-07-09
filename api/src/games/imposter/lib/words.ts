// Word pairs for the Imposter party game. Every player but one gets
// `civilian`; the odd one out gets `imposter` - close enough to the same
// idea that a sharp imposter can bluff, distinct enough that a careless one
// gets caught in discussion.

export interface WordPair {
  civilian: string;
  imposter: string;
}

export interface WordCategory {
  id: string;
  label: string;
  pairs: WordPair[];
}

export const WORD_CATEGORIES: WordCategory[] = [
  {
    id: "food-drink",
    label: "Food & Drink",
    pairs: [
      { civilian: "Coffee", imposter: "Tea" },
      { civilian: "Pizza", imposter: "Burger" },
      { civilian: "Sushi", imposter: "Ramen" },
      { civilian: "Pancakes", imposter: "Waffles" },
      { civilian: "Ice Cream", imposter: "Gelato" },
      { civilian: "Wine", imposter: "Beer" },
      { civilian: "Chocolate", imposter: "Vanilla" },
      { civilian: "Apple", imposter: "Pear" },
      { civilian: "Bread", imposter: "Toast" },
      { civilian: "Soup", imposter: "Stew" },
      { civilian: "Taco", imposter: "Burrito" },
      { civilian: "Donut", imposter: "Muffin" },
      { civilian: "Milkshake", imposter: "Smoothie" },
      { civilian: "Hot Dog", imposter: "Sausage Roll" },
      { civilian: "Cheese", imposter: "Butter" },
    ],
  },
  {
    id: "animals",
    label: "Animals",
    pairs: [
      { civilian: "Cat", imposter: "Dog" },
      { civilian: "Lion", imposter: "Tiger" },
      { civilian: "Horse", imposter: "Donkey" },
      { civilian: "Eagle", imposter: "Hawk" },
      { civilian: "Shark", imposter: "Dolphin" },
      { civilian: "Frog", imposter: "Toad" },
      { civilian: "Rabbit", imposter: "Hare" },
      { civilian: "Wolf", imposter: "Fox" },
      { civilian: "Turtle", imposter: "Tortoise" },
      { civilian: "Crocodile", imposter: "Alligator" },
      { civilian: "Bee", imposter: "Wasp" },
      { civilian: "Owl", imposter: "Bat" },
      { civilian: "Penguin", imposter: "Seal" },
      { civilian: "Camel", imposter: "Llama" },
      { civilian: "Butterfly", imposter: "Moth" },
    ],
  },
  {
    id: "places",
    label: "Places",
    pairs: [
      { civilian: "Beach", imposter: "Desert" },
      { civilian: "Mountain", imposter: "Hill" },
      { civilian: "City", imposter: "Town" },
      { civilian: "Forest", imposter: "Jungle" },
      { civilian: "Lake", imposter: "River" },
      { civilian: "Airport", imposter: "Train Station" },
      { civilian: "School", imposter: "University" },
      { civilian: "Hospital", imposter: "Clinic" },
      { civilian: "Castle", imposter: "Palace" },
      { civilian: "Farm", imposter: "Ranch" },
      { civilian: "Museum", imposter: "Library" },
      { civilian: "Park", imposter: "Garden" },
      { civilian: "Island", imposter: "Peninsula" },
      { civilian: "Cave", imposter: "Tunnel" },
      { civilian: "Village", imposter: "Suburb" },
    ],
  },
  {
    id: "occupations",
    label: "Occupations",
    pairs: [
      { civilian: "Doctor", imposter: "Nurse" },
      { civilian: "Teacher", imposter: "Professor" },
      { civilian: "Police Officer", imposter: "Security Guard" },
      { civilian: "Chef", imposter: "Baker" },
      { civilian: "Pilot", imposter: "Flight Attendant" },
      { civilian: "Firefighter", imposter: "Paramedic" },
      { civilian: "Lawyer", imposter: "Judge" },
      { civilian: "Plumber", imposter: "Electrician" },
      { civilian: "Actor", imposter: "Director" },
      { civilian: "Farmer", imposter: "Gardener" },
      { civilian: "Photographer", imposter: "Painter" },
      { civilian: "Waiter", imposter: "Bartender" },
      { civilian: "Soldier", imposter: "Sailor" },
      { civilian: "Dentist", imposter: "Surgeon" },
      { civilian: "Journalist", imposter: "Blogger" },
    ],
  },
  {
    id: "movies-tv",
    label: "Movies & TV",
    pairs: [
      { civilian: "Superhero Movie", imposter: "Action Movie" },
      { civilian: "Comedy", imposter: "Sitcom" },
      { civilian: "Horror Movie", imposter: "Thriller" },
      { civilian: "Cartoon", imposter: "Anime" },
      { civilian: "Documentary", imposter: "Reality Show" },
      { civilian: "Musical", imposter: "Opera" },
      { civilian: "Game Show", imposter: "Talk Show" },
      { civilian: "Soap Opera", imposter: "Drama Series" },
      { civilian: "Sci-Fi Movie", imposter: "Fantasy Movie" },
      { civilian: "News", imposter: "Podcast" },
      { civilian: "Rom-Com", imposter: "Drama Film" },
      { civilian: "Western", imposter: "War Movie" },
    ],
  },
  {
    id: "sports-games",
    label: "Sports & Games",
    pairs: [
      { civilian: "Soccer", imposter: "Rugby" },
      { civilian: "Basketball", imposter: "Netball" },
      { civilian: "Tennis", imposter: "Badminton" },
      { civilian: "Chess", imposter: "Checkers" },
      { civilian: "Swimming", imposter: "Diving" },
      { civilian: "Boxing", imposter: "Wrestling" },
      { civilian: "Golf", imposter: "Mini Golf" },
      { civilian: "Cricket", imposter: "Baseball" },
      { civilian: "Skiing", imposter: "Snowboarding" },
      { civilian: "Cycling", imposter: "Running" },
      { civilian: "Poker", imposter: "Blackjack" },
      { civilian: "Volleyball", imposter: "Handball" },
      { civilian: "Darts", imposter: "Bowling" },
      { civilian: "Surfing", imposter: "Skateboarding" },
      { civilian: "Marathon", imposter: "Triathlon" },
    ],
  },
  {
    id: "everyday-objects",
    label: "Everyday Objects",
    pairs: [
      { civilian: "Phone", imposter: "Tablet" },
      { civilian: "Laptop", imposter: "Desktop" },
      { civilian: "Backpack", imposter: "Suitcase" },
      { civilian: "Umbrella", imposter: "Raincoat" },
      { civilian: "Sunglasses", imposter: "Glasses" },
      { civilian: "Wallet", imposter: "Purse" },
      { civilian: "Watch", imposter: "Clock" },
      { civilian: "Pen", imposter: "Pencil" },
      { civilian: "Chair", imposter: "Stool" },
      { civilian: "Sofa", imposter: "Armchair" },
      { civilian: "Mirror", imposter: "Window" },
      { civilian: "Candle", imposter: "Lamp" },
      { civilian: "Blanket", imposter: "Pillow" },
      { civilian: "Keyboard", imposter: "Mouse" },
      { civilian: "Headphones", imposter: "Earphones" },
    ],
  },
];

export function findWordCategory(categoryId: string): WordCategory | undefined {
  return WORD_CATEGORIES.find((c) => c.id === categoryId);
}

export function randomPair(category: WordCategory): WordPair {
  return category.pairs[Math.floor(Math.random() * category.pairs.length)];
}
